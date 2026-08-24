import { MemoryAction, MemoryItem, MemoryLink, MemoryScratchpadState } from '../types';
import { consolidateMemories } from './memoryConsolidation';
import { recordLiveMemoryActivity } from './thinkingLiveRuntime';

const ACTIVE_SCRATCHPAD_KEY = 'elara_active_scratchpad_v1';
const SCRATCHPAD_EVENT = 'elara:scratchpad-updated';

function buildPersistentScratchpad(memories: MemoryItem[]): string {
  const ranked = [...memories].sort((a, b) => {
    const importanceRank: Record<string, number> = { core: 4, important: 3, normal: 2, low: 1 };
    return (importanceRank[b.importance] || 0) - (importanceRank[a.importance] || 0);
  }).slice(0, 40);
  if (ranked.length === 0) return '';
  return ranked.map((memory) => `- [${memory.isPrivate ? 'PRIVATE OBSERVATION' : 'SHARED FACT'}] [${memory.category}]${memory.kind ? ` [${memory.kind}]` : ''} [${memory.confidence}] ${memory.content}`).join('\n');
}

function normalizeMemoryLinks(links: MemoryLink[] | undefined, conversationId?: string, sourceArtifactId?: string): MemoryLink[] | undefined {
  const next: MemoryLink[] = [];
  const pushUnique = (link: MemoryLink) => { if (!link.id || next.some((existing) => existing.type === link.type && existing.id === link.id)) return; next.push(link); };
  for (const link of links || []) if (link?.type && link.id) pushUnique(link);
  if (conversationId) pushUnique({ type: 'conversation', id: conversationId, label: 'Source conversation' });
  if (sourceArtifactId) pushUnique({ type: 'artifact', id: sourceArtifactId, label: 'Source artifact' });
  return next.length ? next : undefined;
}

function deriveInitialResolution(kind?: MemoryItem['kind'], lifecycle?: MemoryItem['lifecycle']): MemoryItem['resolution'] {
  if (kind === 'observation') return 'observation';
  if (kind === 'episode') return 'episodic';
  if (lifecycle === 'core') return 'core';
  if (kind === 'project' || kind === 'plan' || kind === 'working' || lifecycle === 'working' || lifecycle === 'contextual') return 'contextual';
  return 'contextual';
}

function persistScratchpad(memories: MemoryItem[]): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  const scratchpad = buildPersistentScratchpad(memories);
  try { localStorage.setItem(ACTIVE_SCRATCHPAD_KEY, scratchpad); window.dispatchEvent(new CustomEvent(SCRATCHPAD_EVENT, { detail: { scratchpad } })); }
  catch (err) { console.warn('Persistent scratchpad mirror unavailable:', err); }
}

export function applyMemoryActions(state: MemoryScratchpadState, actions: MemoryAction[], conversationId?: string): MemoryScratchpadState {
  if (!actions || actions.length === 0) {
    const consolidated = consolidateMemories(state.memories);
    const nextState = consolidated.memories === state.memories ? { ...state, schemaVersion: 3 } : { ...state, memories: consolidated.memories, lastMaintenanceAt: new Date().toISOString(), schemaVersion: 3 };
    persistScratchpad(nextState.memories);
    return nextState;
  }
  let currentMemories = [...state.memories];
  let stateModified = false;
  for (const action of actions) {
    if (!action || action.type === 'NO_ACTION') continue;
    if ((action.type === 'ADD' || action.type === 'CREATE') && action.memory?.content) {
      const now = new Date().toISOString();
      const resolution = action.memory.resolution || deriveInitialResolution(action.memory.kind, action.memory.lifecycle);
      currentMemories.unshift({
        id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        content: action.memory.content, kind: action.memory.kind || 'observation', lifecycle: action.memory.lifecycle || (action.memory.kind === 'working' ? 'working' : 'persistent'),
        source: action.memory.source || 'elara', confidence: action.memory.confidence || 'certain', importance: action.memory.importance || 'normal', isPrivate: action.memory.isPrivate ?? true,
        category: action.memory.category || 'Observations', createdAt: now, updatedAt: now, eventDate: action.memory.eventDate, expiresAt: action.memory.expiresAt, pinned: false,
        tags: action.memory.tags || [], sourceConversationId: conversationId, sourceArtifactId: action.memory.sourceArtifactId, relatedMemoryIds: action.memory.relatedMemoryIds,
        links: normalizeMemoryLinks(action.memory.links, conversationId, action.memory.sourceArtifactId), resolution, state: action.memory.state || 'active', lastObservedAt: now, retrievalCount: 0,
        evidenceCount: action.memory.evidenceMemoryIds?.length ? action.memory.evidenceMemoryIds.length : 1, evidenceMemoryIds: action.memory.evidenceMemoryIds || [],
        supersedesMemoryId: action.memory.supersedesMemoryId, supersededByMemoryId: action.memory.supersededByMemoryId, conflictMemoryIds: action.memory.conflictMemoryIds || [],
      });
      stateModified = true;
    } else if (action.type === 'UPDATE' && action.targetId && action.memory) {
      const index = currentMemories.findIndex((m) => m.id === action.targetId);
      if (index !== -1) {
        const existing = currentMemories[index];
        const sourceArtifactId = action.memory.sourceArtifactId || existing.sourceArtifactId;
        const observedNow = existing.resolution === 'observation' || action.memory.resolution === 'observation';
        currentMemories[index] = {
          ...existing, content: action.memory.content || existing.content, kind: action.memory.kind || existing.kind, lifecycle: action.memory.lifecycle || existing.lifecycle,
          source: action.memory.source || existing.source, confidence: action.memory.confidence || existing.confidence, importance: action.memory.importance || existing.importance,
          isPrivate: action.memory.isPrivate ?? existing.isPrivate, category: action.memory.category || existing.category, updatedAt: new Date().toISOString(),
          eventDate: action.memory.eventDate || existing.eventDate, expiresAt: action.memory.expiresAt || existing.expiresAt, tags: action.memory.tags || existing.tags,
          sourceConversationId: conversationId || existing.sourceConversationId, sourceArtifactId, relatedMemoryIds: action.memory.relatedMemoryIds || existing.relatedMemoryIds,
          links: normalizeMemoryLinks(action.memory.links || existing.links, conversationId || existing.sourceConversationId, sourceArtifactId),
          resolution: action.memory.resolution || existing.resolution || deriveInitialResolution(action.memory.kind || existing.kind, action.memory.lifecycle || existing.lifecycle),
          state: action.memory.state || existing.state || 'active', lastObservedAt: observedNow ? new Date().toISOString() : existing.lastObservedAt,
          evidenceMemoryIds: action.memory.evidenceMemoryIds || existing.evidenceMemoryIds, evidenceCount: Math.max(action.memory.evidenceMemoryIds?.length || 0, existing.evidenceCount || 1),
          supersedesMemoryId: action.memory.supersedesMemoryId || existing.supersedesMemoryId, supersededByMemoryId: action.memory.supersededByMemoryId || existing.supersededByMemoryId,
          conflictMemoryIds: action.memory.conflictMemoryIds || existing.conflictMemoryIds,
        };
        stateModified = true;
      }
    } else if (action.type === 'DELETE' && action.targetId) {
      const before = currentMemories.length;
      currentMemories = currentMemories.filter((m) => m.id !== action.targetId);
      if (currentMemories.length !== before) stateModified = true;
    } else if (action.type === 'MERGE' && action.mergeTargetIds?.length && action.memory) {
      const mergeSet = new Set(action.mergeTargetIds);
      const merged = currentMemories.filter((m) => mergeSet.has(m.id));
      if (merged.length === 0) continue;
      const sourceConversationId = conversationId || merged.find((m) => m.sourceConversationId)?.sourceConversationId;
      const sourceArtifactId = action.memory.sourceArtifactId || merged.find((m) => m.sourceArtifactId)?.sourceArtifactId;
      const now = new Date().toISOString();
      const synthesizedId = `mem_merged_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const mergedEvidenceIds = Array.from(new Set([...merged.map((m) => m.id), ...merged.flatMap((m) => m.evidenceMemoryIds || []), ...(action.memory.evidenceMemoryIds || [])]));
      const mergedRelatedIds = Array.from(new Set([...merged.map((m) => m.id), ...merged.flatMap((m) => m.relatedMemoryIds || []), ...(action.memory.relatedMemoryIds || [])])).filter((id) => id !== synthesizedId);
      currentMemories = currentMemories.map((memory) => mergeSet.has(memory.id) ? { ...memory, state: 'superseded' as const, supersededByMemoryId: synthesizedId, updatedAt: now } : memory);
      currentMemories.unshift({
        id: synthesizedId, content: action.memory.content, kind: action.memory.kind || 'observation', lifecycle: action.memory.lifecycle || 'persistent', source: action.memory.source || 'elara',
        confidence: action.memory.confidence || 'certain', importance: action.memory.importance || 'important', isPrivate: action.memory.isPrivate ?? merged.every((m) => m.isPrivate),
        category: action.memory.category || 'Observations', createdAt: now, updatedAt: now, tags: action.memory.tags || ['merged', 'synthesized'],
        sourceConversationId, sourceArtifactId, relatedMemoryIds: mergedRelatedIds, links: normalizeMemoryLinks(action.memory.links || merged.flatMap((m) => m.links || []), sourceConversationId, sourceArtifactId),
        resolution: action.memory.resolution || 'synthesized', state: action.memory.state || 'active', lastObservedAt: now, retrievalCount: 0,
        evidenceCount: Math.max(mergedEvidenceIds.length, merged.reduce((sum, memory) => sum + Math.max(memory.evidenceCount || 0, 1), 0), 1), evidenceMemoryIds: mergedEvidenceIds,
        supersedesMemoryId: action.memory.supersedesMemoryId, supersededByMemoryId: action.memory.supersededByMemoryId, conflictMemoryIds: action.memory.conflictMemoryIds || [],
      });
      stateModified = true;
    }

    if (typeof window !== 'undefined') {
      recordLiveMemoryActivity(action, action.reason);
    }
  }
  const consolidated = consolidateMemories(currentMemories);
  const nextState = stateModified || consolidated.memories !== currentMemories ? { ...state, memories: consolidated.memories, lastMaintenanceAt: new Date().toISOString(), schemaVersion: 3 } : { ...state, schemaVersion: 3 };
  persistScratchpad(nextState.memories);
  return nextState;
}
