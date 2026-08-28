import { get, set, del } from 'idb-keyval';
import { Conversation, ElaraSettings, WorldState, MemoryScratchpadState, Folder, PersonaSnapshot } from '../types';
import { DEFAULT_SETTINGS, normalizeSettings } from './storage';
import { loadAgentOperatingPolicy, saveAgentOperatingPolicy, AGENT_OPERATING_POLICY_KEY } from './agentPolicy';
import { saveActiveScratchpad, clearActiveScratchpad, clearUserProfileNotes, USER_PROFILE_NOTES_KEY, ACTIVE_SCRATCHPAD_KEY, MEMORY_CONTEXT_MIRROR_KEY } from './contextManager';
import { clearWorkspace } from './workspaceStorage';
import { DEFAULT_WORLD_STATE } from '../constants/defaultWorldState';
import { applySettingsAppearance } from './themeManager';
import { DEFAULT_MEMORY_STATE, MEMORY_SCHEMA_VERSION, normalizeMemoryState } from './memoryStorage';
import { runMemoryMaintenanceCycle } from './memoryMaintenanceScheduler';
import { DIAGNOSTIC_REPORTS_KEY } from './diagnosticReports';

const CONVERSATIONS_KEY = 'elara_conversations_v2';
const SETTINGS_KEY = 'elara_settings_v2';
const PORTRAIT_KEY = 'elara_custom_portrait_v2';
const FOLDERS_KEY = 'elara_folders_v2';
const WORLD_STATE_KEY = 'elara_world_state_v2';
const MEMORY_STATE_KEY = 'elara_memory_state_v2';
const SNAPSHOTS_KEY = 'elara_persona_snapshots_v1';
const MIGRATION_KEY = 'elara_idb_migrated';
const CONVERSATION_PERSIST_DEBOUNCE_MS = 300;
const LEGACY_KEYS = ['elara_conversations_v1','elara_settings_v1','elara_custom_portrait_v1','elara_folders_v1','elara_world_state','elara_memory_state'];
function getLocalStorage(): Storage | null { return typeof localStorage !== 'undefined' ? localStorage : null; }
function readLegacy(key: string): string | null { try { return getLocalStorage()?.getItem(key) ?? null; } catch { return null; } }
function mirrorMemoryState(state: MemoryScratchpadState): void { try { getLocalStorage()?.setItem(MEMORY_CONTEXT_MIRROR_KEY, JSON.stringify({ schemaVersion: state.schemaVersion, memories: state.memories })); } catch (error) { console.warn('Context memory mirror unavailable:', error); } }
function readMemoryMirrorFallback(): MemoryScratchpadState | null { try { const raw = getLocalStorage()?.getItem(MEMORY_CONTEXT_MIRROR_KEY); if (!raw) return null; return normalizeMemoryState(JSON.parse(raw)); } catch (error) { console.warn('Context memory mirror fallback unavailable:', error); return null; } }
async function migrateValue(idbKey: string, legacyKey: string, transform: (value: unknown) => unknown = (value) => value): Promise<boolean> { const raw = readLegacy(legacyKey); if (!raw) return false; try { await set(idbKey, transform(JSON.parse(raw))); return true; } catch (error) { console.error(`Failed to migrate ${legacyKey}:`, error); return false; } }
let conversationsCache: Conversation[] | null = null;
let conversationPersistTimer: ReturnType<typeof setTimeout> | null = null;
async function persistConversationsNow(): Promise<void> { if (!conversationsCache) return; try { await set(CONVERSATIONS_KEY, conversationsCache); } catch (error) { console.warn('Conversation persistence deferred after IndexedDB write failure:', error); } }
export async function flushDbConversations(): Promise<void> { if (conversationPersistTimer) { clearTimeout(conversationPersistTimer); conversationPersistTimer = null; } await persistConversationsNow(); }
if (typeof window !== 'undefined') { const flushOnPageExit = () => { void flushDbConversations(); }; window.addEventListener('pagehide', flushOnPageExit); window.addEventListener('beforeunload', flushOnPageExit); }
export async function migrateFromLocalStorage(): Promise<{ migrated: boolean; failures: string[] }> { const isMigrated = await get(MIGRATION_KEY); if (isMigrated) return { migrated: false, failures: [] }; const failures: string[] = []; const migrations: Array<[string,string,((value:unknown)=>unknown)|undefined]> = [[CONVERSATIONS_KEY,'elara_conversations_v1',(value)=>Array.isArray(value)?value:[]],[SETTINGS_KEY,'elara_settings_v1',(value)=>value&&typeof value==='object'?normalizeSettings(value as Partial<ElaraSettings>):DEFAULT_SETTINGS],[PORTRAIT_KEY,'elara_custom_portrait_v1',undefined],[FOLDERS_KEY,'elara_folders_v1',(value)=>Array.isArray(value)?value:[]],[WORLD_STATE_KEY,'elara_world_state',(value)=>value&&typeof value==='object'?value:DEFAULT_WORLD_STATE],[MEMORY_STATE_KEY,'elara_memory_state',(value)=>normalizeMemoryState(value)]]; for(const [idbKey,legacyKey,transform] of migrations){const migrated=await migrateValue(idbKey,legacyKey,transform);if(!migrated&&readLegacy(legacyKey))failures.push(legacyKey);} if(failures.length===0)await set(MIGRATION_KEY,true); return { migrated: failures.length===0, failures }; }
export async function getDbConversations(): Promise<Conversation[]> { if (conversationsCache) return conversationsCache; const data = await get(CONVERSATIONS_KEY); conversationsCache = Array.isArray(data) ? data : []; return conversationsCache; }
export function setDbConversations(data: Conversation[]): void { conversationsCache = Array.isArray(data) ? data : []; if (conversationPersistTimer) clearTimeout(conversationPersistTimer); conversationPersistTimer = setTimeout(() => { conversationPersistTimer = null; void persistConversationsNow(); }, CONVERSATION_PERSIST_DEBOUNCE_MS); }
export async function getDbSettings(): Promise<ElaraSettings> { const data = await get(SETTINGS_KEY); const settings = normalizeSettings(data&&typeof data==='object'?data as Partial<ElaraSettings>:DEFAULT_SETTINGS); const legacyPolicy = data&&typeof data==='object'&&typeof (data as any).agentBehaviorPolicy==='string'?String((data as any).agentBehaviorPolicy).trim():''; if(legacyPolicy)saveAgentOperatingPolicy(legacyPolicy);else loadAgentOperatingPolicy(); applySettingsAppearance(settings); return settings; }
export async function setDbSettings(data: ElaraSettings){const normalized=normalizeSettings(data);await set(SETTINGS_KEY,normalized);applySettingsAppearance(normalized);}
export async function getDbPortrait():Promise<string|null>{return(await get(PORTRAIT_KEY))||null;}
export async function setDbPortrait(data:string|null){if(data)await set(PORTRAIT_KEY,data);else await del(PORTRAIT_KEY);}
export async function getDbFolders():Promise<Folder[]>{const data=await get(FOLDERS_KEY);return Array.isArray(data)&&data.length>0?data:[{id:'default',name:'General',isExpanded:true}];}
export async function setDbFolders(data:Folder[]){await set(FOLDERS_KEY,Array.isArray(data)?data:[]);}
export async function getDbWorldState():Promise<WorldState>{const data=await get(WORLD_STATE_KEY);return data&&typeof data==='object'?{...DEFAULT_WORLD_STATE,...data} as WorldState:{...DEFAULT_WORLD_STATE};}
export async function setDbWorldState(data:WorldState){await set(WORLD_STATE_KEY,data);}
export interface GetDbMemoryStateOptions{runMaintenance?:boolean;updateProjections?:boolean;}
export async function getDbMemoryState(options:GetDbMemoryStateOptions={}):Promise<MemoryScratchpadState>{const runMaintenance=options.runMaintenance!==false;const updateProjections=options.updateProjections!==false;let raw:unknown;try{raw=await get(MEMORY_STATE_KEY);}catch{const fallback=readMemoryMirrorFallback()||{...DEFAULT_MEMORY_STATE,memories:[]};if(updateProjections)mirrorMemoryState(fallback);return fallback;}const normalized=normalizeMemoryState(raw);let state=normalized;let maintenanceRan=false;if(runMaintenance){const maintenance=runMemoryMaintenanceCycle(normalized);state=maintenance.ran?maintenance.state:normalized;maintenanceRan=maintenance.ran;}if(updateProjections){try{if(state.schemaVersion!==MEMORY_SCHEMA_VERSION||!raw||typeof raw!=='object'||maintenanceRan)await set(MEMORY_STATE_KEY,state);}catch(error){console.warn('Memory database write-back unavailable; retaining runtime state and mirror:',error);}mirrorMemoryState(state);if(state.memories.length>0){const scratchpad=['[ELARA PERSISTENT SCRATCHPAD]','Cross-session working memory about the user and ongoing relationship/context.','Do not invent facts. Treat uncertain observations as uncertain and prefer current user statements.',...state.memories.slice(0,80).map((memory)=>`- [${memory.isPrivate?'PRIVATE':'SHARED'}] [${memory.category}] [${memory.importance}/${memory.confidence}] ${memory.content}`),'[/ELARA PERSISTENT SCRATCHPAD]'].join('\n');saveActiveScratchpad(scratchpad);}}return state;}
export async function setDbMemoryState(data:MemoryScratchpadState){const normalized=normalizeMemoryState(data);try{await set(MEMORY_STATE_KEY,normalized);}catch(error){console.warn('Memory database write failed; current session will continue with in-memory state:',error);}mirrorMemoryState(normalized);}
export async function clearDbStorage(){if(conversationPersistTimer){clearTimeout(conversationPersistTimer);conversationPersistTimer=null;}conversationsCache=null;await Promise.all([del(CONVERSATIONS_KEY),del(SETTINGS_KEY),del(PORTRAIT_KEY),del(FOLDERS_KEY),del(WORLD_STATE_KEY),del(MEMORY_STATE_KEY),del(SNAPSHOTS_KEY),del(MIGRATION_KEY),del(DIAGNOSTIC_REPORTS_KEY)]);clearWorkspace();clearActiveScratchpad();clearUserProfileNotes();try{const storage=getLocalStorage();LEGACY_KEYS.forEach((key)=>storage?.removeItem(key));storage?.removeItem(AGENT_OPERATING_POLICY_KEY);storage?.removeItem(USER_PROFILE_NOTES_KEY);storage?.removeItem(ACTIVE_SCRATCHPAD_KEY);storage?.removeItem(MEMORY_CONTEXT_MIRROR_KEY);}catch(error){console.error('Failed to clear browser persistence:',error);}}
export async function getDbSnapshots():Promise<PersonaSnapshot[]>{const data=await get(SNAPSHOTS_KEY);return Array.isArray(data)?data:[];}
export async function setDbSnapshots(data:PersonaSnapshot[]){await set(SNAPSHOTS_KEY,Array.isArray(data)?data:[]);}
