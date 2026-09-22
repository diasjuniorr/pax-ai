import { conversationStateSchema, type ConversationState } from '@pax/shared';
const input = document.getElementById('conversation-input') as HTMLTextAreaElement;
const send = document.getElementById('conversation-send') as HTMLButtonElement;
const status = document.getElementById('conversation-status')!;
const error = document.getElementById('conversation-error')!;
const messages = document.getElementById('conversation-messages')!;
let sessionId: string | null = null;
let state: ConversationState | undefined;
let sending = false, refreshing = false, available = false, revision = 0;
let rendered = '';
function controls() {
  input.disabled = send.disabled = !available || !sessionId || !state?.configured || !!state.voiceActive || sending || state?.status === 'processing';
  status.textContent = !available ? 'Conversation connection unavailable; retrying' : !sessionId ? 'Start a flight session to chat.'
    : state?.voiceActive ? 'Disconnect voice to use text conversation.' : !state?.configured ? 'Text conversation needs OPENAI_API_KEY in the server environment.'
    : sending || state.status === 'processing' ? 'Passenger is thinking…' : 'Ready to talk';
}
function render(value: unknown) {
  const next = conversationStateSchema.parse(value);
  if (next.sessionId !== sessionId) return;
  state = next; available = true;
  const serialized = JSON.stringify(next.messages);
  if (serialized !== rendered) {
    rendered = serialized;
    messages.replaceChildren(...next.messages.map(message => {
      const item = document.createElement('li');
      item.textContent = `${message.role === 'user' ? 'You' : 'Passenger'}: ${message.content}`;
      return item;
    }));
    messages.scrollTop = messages.scrollHeight;
  }
  controls();
}
async function request(data?: unknown) {
  const response = await fetch('/api/conversation', {
    ...(data === undefined ? { cache: 'no-store' as const } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(40000),
  });
  if (response.status === 401) { location.reload(); throw new Error('Please sign in again.'); }
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'Conversation unavailable.');
  return value;
}
async function refresh() {
  if (refreshing || sending) return;
  refreshing = true;
  const current = revision;
  try { const value = await request(); if (current === revision) render(value); }
  catch { if (current === revision) { available = false; controls(); } }
  finally { refreshing = false; }
}
document.addEventListener('pax-session', event => {
  const next = (event as CustomEvent<string | null>).detail;
  if (next === sessionId) return;
  sessionId = next; revision++; sending = false; state = undefined; available = false;
  input.value = ''; error.textContent = ''; messages.replaceChildren(); rendered = '';
  controls(); void refresh();
});
document.getElementById('conversation-form')!.addEventListener('submit', event => {
  event.preventDefault();
  const message = input.value.trim();
  if (send.disabled || !message || !sessionId) return;
  const current = ++revision;
  sending = true; error.textContent = ''; controls();
  void (async () => {
    try {
      const value = await request({ sessionId, requestId: crypto.randomUUID(), message });
      if (current === revision) { render(value); input.value = ''; }
    } catch (failure) {
      if (current === revision) error.textContent = failure instanceof Error ? failure.message : 'Could not send. Refresh to check whether a reply arrived before sending again.';
    } finally {
      if (current === revision) { sending = false; controls(); await refresh(); }
    }
  })();
});
void refresh(); setInterval(() => void refresh(), 3000);
