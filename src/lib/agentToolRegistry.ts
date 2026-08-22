import { workspaceToolDeclarations, executeAnyWorkspaceTool } from './workspaceTools';
import { googleAgentToolDeclarations, GOOGLE_AGENT_TOOL_NAMES, executeGoogleAgentTool } from './googleAgentTools';
import { googleOperationalToolDeclarations, GOOGLE_OPERATIONAL_TOOL_NAMES, executeGoogleOperationalTool } from './googleAgentOperationalTools';
import { GOOGLE_AUTH_LIFECYCLE_TOOL_DECLARATION, executeGoogleAuthLifecycleTool } from './googleAuthLifecycleTool';
import { getGoogleRuntimeStatus } from './googleRuntime';
import { markGoogleAuthInvalid } from './googleAuthLifecycle';
import { authorizeGoogleAction, classifyGoogleAction } from './googleAuthorizationPolicy';
import { getGoogleIdentityAccessToken, getGrantedGoogleScopes } from './googleAuthorization';
import { getGoogleCapabilityForTool, getMissingGoogleCapabilityScopes, isGoogleCapabilityGranted } from './googleCapabilityPolicy';
import { Workspace } from '../types';

const googleDeclarations = [
  ...googleAgentToolDeclarations,
  ...googleOperationalToolDeclarations,
  GOOGLE_AUTH_LIFECYCLE_TOOL_DECLARATION,
];

const GOOGLE_BACKED_WORKSPACE_WRITE_TOOLS = new Set([
  'create_google_doc',
  'update_google_doc',
  'link_google_doc',
  'sync_to_google_doc',
  'sync_from_google_doc',
]);

function withExternalActionConfirmation(tool: any) {
  const actionClass = classifyGoogleAction(tool.name);
  if (actionClass === 'read') return tool;

  const parameters = tool.parameters || { type: 'OBJECT', properties: {} };
  const properties = { ...(parameters.properties || {}) };
  properties.userConfirmed = {
    type: 'BOOLEAN',
    description: 'Must be true only when the user has explicitly confirmed this external Google write/delete/revoke operation.',
  };

  const required = Array.from(new Set([...(parameters.required || []), 'userConfirmed']));
  return {
    ...tool,
    description: `${tool.description || ''} Explicit user confirmation is required before this operation changes Google data or authentication state.`,
    parameters: { ...parameters, properties, required },
  };
}

function withWorkspaceGoogleConfirmation(tool: any) {
  if (!GOOGLE_BACKED_WORKSPACE_WRITE_TOOLS.has(tool.name)) return tool;
  return withExternalActionConfirmation(tool);
}

const workspaceDeclarations = workspaceToolDeclarations.map(withWorkspaceGoogleConfirmation);

export const agentToolDeclarations = [
  ...workspaceDeclarations,
  ...googleDeclarations.map(withExternalActionConfirmation),
];

export type AgentToolExecution = {
  result: any;
  updatedWorkspace: Workspace;
  createdArtifactId?: string;
  modifiedArtifactId?: string;
  externalDocUrl?: string;
};

export function getAgentConnectionContext(): string {
  return getGoogleRuntimeStatus().hint;
}

function requireIncrementalGoogleCapability(toolName: string): { allowed: true } | { allowed: false; result: any } {
  const capability = getGoogleCapabilityForTool(toolName);
  if (!capability) return { allowed: true };

  const grantedScopes = getGrantedGoogleScopes();
  if (isGoogleCapabilityGranted(grantedScopes, capability)) return { allowed: true };

  return {
    allowed: false,
    result: {
      success: false,
      provider: 'google',
      errorCode: 'GOOGLE_CAPABILITY_AUTH_REQUIRED',
      message: `Google capability authorization is required for ${capability}. Elara will not request broad Workspace permissions automatically.`,
      requiresUserAuth: true,
      capability,
      missingScopes: getMissingGoogleCapabilityScopes(grantedScopes, capability),
      resumeToolName: toolName,
    },
  };
}

export async function executeAgentTool(
  workspace: Workspace,
  toolName: string,
  args: any,
  googleToken?: string,
): Promise<AgentToolExecution> {
  const isGoogleTool =
    GOOGLE_AGENT_TOOL_NAMES.has(toolName) ||
    GOOGLE_OPERATIONAL_TOOL_NAMES.has(toolName) ||
    GOOGLE_BACKED_WORKSPACE_WRITE_TOOLS.has(toolName) ||
    toolName === GOOGLE_AUTH_LIFECYCLE_TOOL_DECLARATION.name;

  if (isGoogleTool) {
    const authorization = authorizeGoogleAction(toolName, args, googleToken || getGoogleIdentityAccessToken() || 'session');
    if (!authorization.allowed) {
      return {
        result: authorization,
        updatedWorkspace: workspace,
      };
    }

    if (toolName !== GOOGLE_AUTH_LIFECYCLE_TOOL_DECLARATION.name) {
      const capability = requireIncrementalGoogleCapability(toolName);
      if (!capability.allowed) return { result: capability.result, updatedWorkspace: workspace };
    }
  }

  const effectiveGoogleToken = getGoogleIdentityAccessToken() || googleToken;

  if (toolName === GOOGLE_AUTH_LIFECYCLE_TOOL_DECLARATION.name) {
    return {
      result: await executeGoogleAuthLifecycleTool(toolName, args),
      updatedWorkspace: workspace,
    };
  }

  if (GOOGLE_AGENT_TOOL_NAMES.has(toolName)) {
    const result = await executeGoogleAgentTool(toolName, args, effectiveGoogleToken);
    if (result?.errorCode === 'GOOGLE_AUTH_REQUIRED') markGoogleAuthInvalid();
    return { result, updatedWorkspace: workspace };
  }

  if (GOOGLE_OPERATIONAL_TOOL_NAMES.has(toolName)) {
    const result = await executeGoogleOperationalTool(toolName, args, effectiveGoogleToken);
    if (result?.errorCode === 'GOOGLE_AUTH_REQUIRED') markGoogleAuthInvalid();
    return { result, updatedWorkspace: workspace };
  }

  const operation = await executeAnyWorkspaceTool(workspace, toolName, args, effectiveGoogleToken);
  if (operation.result?.errorCode === 'GOOGLE_AUTH_REQUIRED') markGoogleAuthInvalid();
  return {
    result: operation.result,
    updatedWorkspace: operation.updatedWorkspace,
    createdArtifactId: operation.createdArtifactId,
    modifiedArtifactId: operation.modifiedArtifactId,
    externalDocUrl: operation.externalDocUrl,
  };
}
