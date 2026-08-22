export type GoogleCapability =
  | 'gmail.read'
  | 'gmail.compose'
  | 'gmail.send'
  | 'gmail.modify'
  | 'calendar.read'
  | 'calendar.write'
  | 'tasks'
  | 'docs'
  | 'drive.read'
  | 'drive.file'
  | 'sheets.read'
  | 'sheets.write'
  | 'keep.read'
  | 'keep.write'
  | 'contacts.read'
  | 'chat.read'
  | 'chat.send'
  | 'chat.manage';

const CAPABILITY_SCOPES: Record<GoogleCapability, string[]> = {
  'gmail.read': ['https://www.googleapis.com/auth/gmail.readonly'],
  'gmail.compose': ['https://www.googleapis.com/auth/gmail.compose'],
  'gmail.send': ['https://www.googleapis.com/auth/gmail.send'],
  'gmail.modify': ['https://www.googleapis.com/auth/gmail.modify'],
  'calendar.read': ['https://www.googleapis.com/auth/calendar.readonly'],
  'calendar.write': ['https://www.googleapis.com/auth/calendar.events'],
  tasks: ['https://www.googleapis.com/auth/tasks'],
  docs: ['https://www.googleapis.com/auth/documents'],
  'drive.read': ['https://www.googleapis.com/auth/drive.readonly'],
  'drive.file': ['https://www.googleapis.com/auth/drive.file'],
  'sheets.read': ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  'sheets.write': ['https://www.googleapis.com/auth/spreadsheets'],
  'keep.read': ['https://www.googleapis.com/auth/keep.readonly'],
  'keep.write': ['https://www.googleapis.com/auth/keep'],
  'contacts.read': ['https://www.googleapis.com/auth/contacts.readonly'],
  'chat.read': [
    'https://www.googleapis.com/auth/chat.spaces.readonly',
    'https://www.googleapis.com/auth/chat.messages.readonly',
    'https://www.googleapis.com/auth/chat.memberships.readonly',
  ],
  'chat.send': ['https://www.googleapis.com/auth/chat.messages.create'],
  'chat.manage': [
    'https://www.googleapis.com/auth/chat.spaces',
    'https://www.googleapis.com/auth/chat.spaces.create',
    'https://www.googleapis.com/auth/chat.messages',
    'https://www.googleapis.com/auth/chat.memberships',
  ],
};

export function getGoogleCapabilityScopes(capability: GoogleCapability): string[] {
  return [...CAPABILITY_SCOPES[capability]];
}

export function isGoogleCapabilityGranted(grantedScopes: string, capability: GoogleCapability): boolean {
  const granted = new Set(grantedScopes.split(/\s+/).map((scope) => scope.trim()).filter(Boolean));
  return getGoogleCapabilityScopes(capability).every((scope) => granted.has(scope));
}

export function getMissingGoogleCapabilityScopes(grantedScopes: string, capability: GoogleCapability): string[] {
  const granted = new Set(grantedScopes.split(/\s+/).map((scope) => scope.trim()).filter(Boolean));
  return getGoogleCapabilityScopes(capability).filter((scope) => !granted.has(scope));
}

export function getGoogleCapabilityForTool(toolName: string): GoogleCapability | null {
  const name = toolName.toLowerCase();
  if (name.includes('gmail') || name.includes('email')) {
    if (name.includes('send')) return 'gmail.send';
    if (name.includes('draft') || name.includes('compose')) return 'gmail.compose';
    if (name.includes('label') || name.includes('modify')) return 'gmail.modify';
    return 'gmail.read';
  }
  if (name.includes('calendar')) return name.includes('create') || name.includes('update') || name.includes('write') ? 'calendar.write' : 'calendar.read';
  if (name.includes('task')) return 'tasks';
  if (name.includes('keep')) return name.includes('create') || name.includes('update') || name.includes('delete') || name.includes('write') ? 'keep.write' : 'keep.read';
  if (name.includes('sheet') || name.includes('spreadsheet')) return name.includes('create') || name.includes('write') || name.includes('append') || name.includes('update') || name.includes('batch') ? 'sheets.write' : 'sheets.read';
  if (name.includes('doc')) return 'docs';
  if (name.includes('drive')) return name.includes('create') || name.includes('upload') ? 'drive.file' : 'drive.read';
  if (name.includes('contact')) return 'contacts.read';
  if (name.includes('chat')) {
    if (name.includes('create_space') || name.includes('manage') || name.includes('membership')) return 'chat.manage';
    if (name.includes('send') || name.includes('message')) return name.includes('read') ? 'chat.read' : 'chat.send';
    return 'chat.read';
  }
  return null;
}
