import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildPassengerContext, ConversationStore, createOpenAIProvider, type Message } from '../apps/server/src/conversation';
import { FlightSessionStore, generatePassenger } from '../apps/server/src/passenger';

function session() {
  return new FlightSessionStore().start({ passenger: { ...generatePassenger(), name: 'Test passenger' },
    expectedDurationMinutes: 45, origin: 'Madrid', destination: 'Lisbon' })!;
}
const input = (id: string, message = 'Why are you traveling?') => ({ sessionId: id, requestId: randomUUID(), message });

test('context includes the edited identity and planned flight without claiming live observations', () => {
  const current = session();
  const context = buildPassengerContext(current);
  assert.match(context, /Test passenger/);
  assert.match(context, /Madrid/);
  assert.match(context, /45/);
  assert.match(context, /not instructions/);
  assert.match(context, /Do not invent them/);
  assert.doesNotMatch(context, /latitude|longitude|altitudeMslFeet|startedAt/);
});

test('conversation bounds history, deduplicates requests, isolates snapshots and resets identity', async () => {
  const seen: Message[][] = [];
  const store = new ConversationStore({ provider: async (_, messages) => { seen.push(messages); return { text: 'Hello from the passenger.' }; } });
  const current = session(); store.reset(current.id);
  const first = input(current.id);
  await store.send(current, first);
  await store.send(current, first);
  assert.equal(seen.length, 1);
  await assert.rejects(store.send(current, { ...first, message: 'Changed' }), /already used/);
  const copy = store.snapshot(); copy.messages[0]!.content = 'Tampered';
  assert.equal(store.snapshot().messages[0]!.content, first.message);
  for (let i = 0; i < 15; i++) await store.send(current, input(current.id, `Question ${i}`));
  assert.equal(store.snapshot().messages.length, 20);
  assert.ok(seen.every(messages => messages.length <= 21));
  assert.equal(store.snapshot().messages[0]!.content, 'Question 5');
  store.reset(null);
  assert.deepEqual(store.snapshot().messages, []);
  await assert.rejects(store.send(current, input(current.id)), /no longer active/);
  const next = session(); store.reset(next.id); await store.send(next, input(next.id));
  assert.equal(seen.at(-1)!.length, 1);
});

test('concurrent replies are rejected and ending a session cancels pending work without contaminating a new session', async () => {
  let finish!: (value: { text: string }) => void;
  let signal!: AbortSignal;
  let calls = 0;
  const store = new ConversationStore({ provider: async (_, __, abort) => {
    signal = abort;
    if (++calls === 1) return new Promise(resolve => { finish = resolve; });
    return { text: 'New session reply' };
  } });
  const current = session(); store.reset(current.id);
  const pending = store.send(current, input(current.id));
  assert.equal(store.snapshot().status, 'processing');
  await assert.rejects(store.send(current, input(current.id)), /already preparing/);
  const rejected = assert.rejects(pending, /session ended/);
  store.reset(null);
  assert.equal(signal.aborted, true);
  const next = session(); store.reset(next.id);
  await store.send(next, input(next.id));
  finish({ text: 'Obsolete reply' }); await rejected;
  assert.equal(store.snapshot().sessionId, next.id);
  assert.deepEqual(store.snapshot().messages.map(message => message.content), ['Why are you traveling?', 'New session reply']);
  assert.equal(store.snapshot().status, 'idle');
});

test('missing configuration, invalid input, failures and timeouts make no partial turns and recover to idle', async () => {
  const current = session();
  const disabled = new ConversationStore(); disabled.reset(current.id);
  assert.equal(disabled.snapshot().configured, false);
  await assert.rejects(disabled.send(current, input(current.id)), /not configured/);
  let calls = 0;
  const store = new ConversationStore({ timeoutMs: 15, provider: async () => {
    calls++;
    if (calls === 1) throw new Error('secret provider internals');
    if (calls === 2) return new Promise(() => {});
    return { text: 'Recovered' };
  } });
  store.reset(current.id);
  for (const message of ['', 'a'.repeat(2001)]) await assert.rejects(store.send(current, input(current.id, message)));
  assert.equal(calls, 0);
  await assert.rejects(store.send(current, input(current.id)), error => error instanceof Error && !error.message.includes('secret') && /could not reply/.test(error.message));
  await assert.rejects(store.send(current, input(current.id)), /timed out/);
  assert.equal(store.snapshot().status, 'idle');
  assert.equal(store.snapshot().messages.length, 0);
  await store.send(current, input(current.id));
  assert.equal(store.snapshot().messages.length, 2);
});

test('Responses adapter uses server credentials, bounded text output, explicit non-storage and extracts text/usage', async () => {
  assert.equal(createOpenAIProvider(undefined), undefined);
  const provider = createOpenAIProvider('test-api-key', 'gpt-4.1-mini', async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal((options!.headers as Record<string, string>).Authorization, 'Bearer test-api-key');
    assert.deepEqual(JSON.parse(String(options!.body)), { model: 'gpt-4.1-mini', instructions: 'Context', input: [{ role: 'user', content: 'Hello' }], store: false, max_output_tokens: 400 });
    return Response.json({ status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: 'Hello there' }] }], usage: { input_tokens: 30, output_tokens: 3 } });
  })!;
  assert.deepEqual(await provider('Context', [{ role: 'user', content: 'Hello' }], new AbortController().signal), {
    text: 'Hello there', usage: { inputTokens: 30, outputTokens: 3 },
  });
});

test('Responses adapter handles quota, incomplete, empty and refusal responses without exposing upstream bodies', async () => {
  for (const [response, pattern] of [
    [new Response('secret upstream body', { status: 401 }), /configuration/],
    [new Response('secret upstream body', { status: 429 }), /API credits/],
    [Response.json({ status: 'incomplete', output: [] }), /incomplete/],
    [Response.json({ status: 'completed', output: [] }), /no usable/],
  ] as const) {
    const provider = createOpenAIProvider('test-key', undefined, async () => response)!;
    await assert.rejects(provider('', [], new AbortController().signal), pattern);
  }
  const provider = createOpenAIProvider('test-key', undefined, async () => Response.json({ status: 'completed', output: [
    { type: 'message', content: [{ type: 'refusal', refusal: 'I cannot help with that.' }] },
  ] }))!;
  assert.equal((await provider('', [], new AbortController().signal)).text, 'I cannot help with that.');
});
