import { Workspace } from '../types';
import { getModelProfile } from './modelRegistry';
import { agentToolDeclarations, executeAgentTool, AgentToolExecution } from './agentToolRegistry';
import { buildWorkspaceContextPrompt } from './workspaceTools';
import { TEXT_PROCESSING_POLICY } from '../constants/textProcessingPolicy';
import { recordLiveToolActivity } from './thinkingLiveRuntime';

export const MAX_AGENT_ITERATIONS = 5;

/**
 * Safety overrides are intentionally empty by default. Gemini 2.5/3 use the
 * provider's default safety policy unless a specific feature opts into a
 * per-request override. In particular, BLOCK_NONE is a restricted threshold
 * for some accounts/projects and must not be forced on every request.
 */
export const ELARA_SAFETY_SETTINGS: any[] = [];

export interface ChatHistoryMessage {
  role: string;
  content?: string;
  image?: string;
}

export interface RuntimeConfigOptions {
  model: string;
  systemPrompt?: string;
  workspace?: Workspace;
  googleToken?: string;
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  thinkingBudget?: number;
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';
  /** @deprecated Kept for compatibility; safety overrides are opt-in only. */
  includeSafetySettings?: boolean;
}

export function parseRuntimeDataUrl(value: string): { mimeType: string; data: string } | null {
  const match = value.match(/^data:([a-zA-Z0-9]+\\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
  return match ? { mimeType: match[1], data: match[2] } : null;
}

export function deriveThinkingLevel(explicitLevel: RuntimeConfigOptions['thinkingLevel'], budget?: number): 'minimal' | 'low' | 'medium' | 'high' {
  if (explicitLevel) return explicitLevel;
  if (typeof budget !== 'number' || budget < 0) return 'medium';
  if (budget === 0) return 'minimal';
  if (budget <= 2048) return 'low';
  if (budget <= 6144) return 'medium';
  return 'high';
}

export function normalizeModel(model: string, fallback = 'gemini-3.7-flash'): string {
  return model.replace(/^models\\//, '').trim() || fallback;
}

export function buildConversationContents(
  history: ChatHistoryMessage[] = [],
  message?: string,
  image?: string,
) {
  const contents: any[] = [];
  for (const item of history) {
    const parts: any[] = [];
    if (item.image) {
      const parsed = parseRuntimeDataUrl(item.image);
      if (parsed) parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
    }
    if (item.content) parts.push({ text: item.content });
    if (parts.length) contents.push({ role: item.role === 'assistant' ? 'model' : 'user', parts });
  }

  if (message || image) {
    const parts: any[] = [];
    if (image) {
      const parsed = parseRuntimeDataUrl(image);
      if (parsed) parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
    }
    parts.push({ text: message || 'Please look at this image and share your thoughts as Elara.' });
    contents.push({ role: 'user', parts });
  }
  return contents;
}

export function buildRuntimeConfig(options: RuntimeConfigOptions): any {
  const model = normalizeModel(options.model);
  const profile = getModelProfile(model);
  const workspaceContext = buildWorkspaceContextPrompt(options.workspace, Boolean(options.googleToken));
  const config: any = {};

  const combinedPrompt = [TEXT_PROCESSING_POLICY, options.systemPrompt || '', workspaceContext].filter(Boolean).join('\n\n').trim();
  if (combinedPrompt) config.systemInstruction = combinedPrompt;

  if (ELARA_SAFETY_SETTINGS.length > 0) {
    config.safetySettings = ELARA_SAFETY_SETTINGS;
  }

  if (profile.supportsTemperature && typeof options.temperature === 'number') {
    config.temperature = Math.min(profile.temperatureMax, Math.max(profile.temperatureMin, options.temperature));
  }
  if (typeof options.maxOutputTokens === 'number' && options.maxOutputTokens > 0) {
    config.maxOutputTokens = Math.min(profile.maxOutputTokensMax, Math.max(profile.maxOutputTokensMin, options.maxOutputTokens));
  }
  if (profile.supportsTopP && typeof options.topP === 'number') {
    config.topP = Math.min(profile.topPMax, Math.max(profile.topPMin, options.topP));
  }
  if (profile.supportsTopK && typeof options.topK === 'number') {
    config.topK = Math.min(profile.topKMax, Math.max(profile.topKMin, options.topK));
  }

  if (profile.thinkingControl === 'level') {
    let level = deriveThinkingLevel(options.thinkingLevel, options.thinkingBudget);
    if (!profile.thinkingLevels?.includes(level)) level = profile.thinkingLevels?.[0] || 'low';
    config.thinkingConfig = { thinkingLevel: level, includeThoughts: true };
  } else if (profile.thinkingControl === 'budget') {
    config.thinkingConfig = { thinkingBudget: typeof options.thinkingBudget === 'number' ? options.thinkingBudget : -1, includeThoughts: true };
  }

  config.tools = [{ functionDeclarations: agentToolDeclarations }];
  return config;
}

export async function executeAgentToolCall(
  workspace: Workspace,
  toolName: string,
  args: any,
  googleToken?: string,
): Promise<AgentToolExecution> {
  const execution = await executeAgentTool(workspace, toolName, args, googleToken);

  if (typeof window !== 'undefined') {
    recordLiveToolActivity({
      name: toolName,
      args,
      result: execution.result,
    });
  }

  if (typeof window !== 'undefined' && execution.createdArtifactId) {
    const artifact = execution.updatedWorkspace.artifacts.find((item) => item.id === execution.createdArtifactId);
    if (artifact) {
      try {
        window.dispatchEvent(new CustomEvent('elara:artifact-created', { detail: { artifact, action: 'created' } }));
      } catch {
        // Best effort UI notification only.
      }
    }
  }
  return execution;
}

export function mergeTouchedArtifactIds(current: string[], execution: AgentToolExecution): string[] {
  return Array.from(new Set([
    ...current,
    ...(execution.createdArtifactId ? [execution.createdArtifactId] : []),
    ...(execution.modifiedArtifactId ? [execution.modifiedArtifactId] : []),
  ]));
}
