import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flightSessionInputSchema, passengerProfileSchema } from '@pax/shared';
import { FlightSessionStore, generatePassenger } from '../apps/server/src/passenger';

const manual = { name: '  Jordan  ', age: 32, gender: 'Prefer not to specify', occupation: 'Engineer',
  tripReason: 'Visiting friends', personalityTraits: ['thoughtful', 'curious'], flightDisposition: 'calm' };
test('manual and generated profiles share validation; generated profiles are independent copies', () => {
  assert.equal(passengerProfileSchema.parse(manual).name, 'Jordan');
  for (let i = 0; i < 30; i++) {
    const profile = generatePassenger();
    assert.ok(passengerProfileSchema.safeParse(profile).success);
    profile.personalityTraits.push('modified');
    assert.ok(!generatePassenger().personalityTraits.includes('modified'));
  }
  for (const change of [{ age: 0 }, { age: 1.5 }, { name: '  ' }, { personalityTraits: ['warm', 'Warm'] }, { tripReason: 'x'.repeat(401) }])
    assert.equal(passengerProfileSchema.safeParse({ ...manual, ...change }).success, false);
});
test('session owns a profile snapshot, rejects replacement and stale end requests', () => {
  const store = new FlightSessionStore();
  const input = { passenger: { ...manual, personalityTraits: ['thoughtful'] }, expectedDurationMinutes: 45 };
  const before = Date.now();
  const session = store.start(input)!;
  assert.ok(session.startedAt >= before);
  assert.equal(session.origin, undefined);
  input.passenger.personalityTraits.push('changed');
  session.passenger.name = 'changed';
  assert.equal(store.snapshot().session?.passenger.name, 'Jordan');
  assert.deepEqual(store.snapshot().session?.passenger.personalityTraits, ['thoughtful']);
  assert.equal(store.start(input), null);
  assert.equal(store.end('wrong-id'), false);
  assert.equal(store.end(session.id), true);
  const replacement = store.start(input)!;
  assert.notEqual(replacement.id, session.id);
  assert.equal(store.end(session.id), false);
  assert.equal(new FlightSessionStore().snapshot().session, null);
  for (const minutes of [0, -1, 1.5, 1441])
    assert.equal(flightSessionInputSchema.safeParse({ ...input, expectedDurationMinutes: minutes }).success, false);
});
