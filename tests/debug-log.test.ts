import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DebugLog } from '../apps/server/src/debug-log';
import { debugLogSchema } from '@pax/shared';

test('debug log bounds history, isolates copies, and only includes approved metadata', () => {
  const log = new DebugLog();
  for (let i = 0; i < 510; i++) log.append('PASSENGER', 'Reaction decision', { eventId: String(i), status: 'suppressed', eventAgeMs: -120,
    apiKey: 'secret', transcript: 'private speech', instructions: 'private prompt', error: 'provider body', passenger: { name: 'Private' } });
  const data = debugLogSchema.parse(log.snapshot());
  assert.equal(data.entries.length, 500); assert.equal(data.entries[0]!.details.eventId, '10');
  assert.equal(new Set(data.entries.map(e => e.id)).size, 500);
  assert.equal(data.entries[0]!.level, 'warn');
  assert.deepEqual(data.entries[0]!.details, { eventId: '10', status: 'suppressed', eventAgeMs: -120 });
  data.entries[0]!.details.eventAgeMs = 100;
  assert.equal(log.snapshot().entries[0]!.details.eventAgeMs, -120);
});
