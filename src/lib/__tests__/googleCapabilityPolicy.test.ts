import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getGoogleCapabilityForTool,
  getGoogleCapabilityScopes,
  getMissingGoogleCapabilityScopes,
  isGoogleCapabilityGranted,
} from '../googleCapabilityPolicy';

test('maps Google tools to least-privilege capabilities', () => {
  assert.equal(getGoogleCapabilityForTool('search_gmail'), 'gmail.read');
  assert.equal(getGoogleCapabilityForTool('send_gmail_message'), 'gmail.send');
  assert.equal(getGoogleCapabilityForTool('create_calendar_event'), 'calendar.write');
  assert.equal(getGoogleCapabilityForTool('read_google_keep_note'), 'keep.read');
  assert.equal(getGoogleCapabilityForTool('delete_google_keep_note'), 'keep.write');
  assert.equal(getGoogleCapabilityForTool('read_google_sheet_range'), 'sheets.read');
  assert.equal(getGoogleCapabilityForTool('write_google_sheet_range'), 'sheets.write');
});

test('detects missing and fully granted capability scopes', () => {
  const readScope = getGoogleCapabilityScopes('gmail.read')[0];
  assert.equal(isGoogleCapabilityGranted(readScope, 'gmail.read'), true);
  assert.deepEqual(getMissingGoogleCapabilityScopes('', 'gmail.read'), [readScope]);
});

test('Keep write is distinct from Keep read', () => {
  assert.notDeepEqual(getGoogleCapabilityScopes('keep.read'), getGoogleCapabilityScopes('keep.write'));
});
