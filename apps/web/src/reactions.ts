import { reactionStateSchema } from '@pax/shared';
const toggle = document.getElementById('reactions-enabled') as HTMLInputElement;
const status = document.getElementById('reaction-status')!;
const list = document.getElementById('reaction-decisions')!;
let sessionId: string | null = null, busy = false, polling = false, revision = 0;
let rendered = '';
let diagnosticState: ReturnType<typeof reactionStateSchema.parse> | undefined;
const download = document.getElementById('download-reaction-log') as HTMLButtonElement;
const logStatus = document.getElementById('reaction-log-status')!;
download.addEventListener('click', () => {
  if (!diagnosticState) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'pax-reaction-diagnostics-v1', exportedAt: new Date().toISOString(), ...diagnosticState }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'pax-reaction-diagnostics.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
async function request(data?: unknown) {
  const response = await fetch('/api/reactions', { ...(data === undefined ? { cache: 'no-store' as const }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Reaction controls unavailable.');
  return reactionStateSchema.parse(await response.json());
}
function render(state: ReturnType<typeof reactionStateSchema.parse>) {
  diagnosticState = state; download.disabled = false; logStatus.textContent = `Last fetched ${new Date().toLocaleTimeString()}. Last 100 decision transitions; resets when the passenger session ends or server restarts.`;
  sessionId = state.sessionId; toggle.checked = state.enabled; toggle.disabled = !sessionId || busy;
  status.textContent = !sessionId ? 'Start a passenger session to preview reactions.' : state.enabled
    ? 'Automatic comments enabled · connect voice and keep this tab visible.' : 'Silent preview · events are explained without starting an AI reply.';
  document.dispatchEvent(new CustomEvent('pax-reactions-enabled', { detail: state.enabled }));
  const next = JSON.stringify(state.decisions);
  if (next !== rendered) {
    rendered = next;
    list.replaceChildren(...state.decisions.slice().reverse().map(decision => {
      const item = document.createElement('li');
      item.textContent = `${new Date(decision.timestamp).toLocaleTimeString()} · ${decision.event} · ${decision.status.toUpperCase()} — ${decision.reason}. ${decision.observation}`;
      if (decision.diagnostics) {
        const d = decision.diagnostics;
        const detail = document.createElement('div');
        detail.textContent = `Event age: ${d.eventAgeMs} ms (server minus event timestamp) · Gate: ${d.gateForward ? 'accepted' : 'rejected'} / ${d.gateReason} · Detector: ${d.detectorStatus} · Receipt age at detection: ${d.receiptAgeMs ?? 'unknown'} ms`;
        item.append(detail);
      }
      return item;
    }));
  }
}
async function refresh() {
  if (busy || polling) return;
  polling = true; const current = revision;
  try { const state = await request(); if (current === revision) render(state); }
  catch { if (current === revision) { toggle.disabled = true; logStatus.textContent = 'Connection unavailable. Download contains only the last fetched diagnostics.'; status.textContent = 'Reaction controls unavailable; retrying.'; document.dispatchEvent(new CustomEvent('pax-reactions-enabled', { detail: false })); } }
  finally { polling = false; }
}
toggle.addEventListener('change', () => {
  if (!sessionId || busy) return;
  busy = true; revision++; toggle.disabled = true;
  if (!toggle.checked) document.dispatchEvent(new CustomEvent('pax-reactions-enabled', { detail: false }));
  void request({ sessionId, enabled: toggle.checked }).then(render).catch(() => { status.textContent = 'Could not change reactions. Checking server state…'; })
    .finally(() => { busy = false; void refresh(); });
});
document.addEventListener('pax-session', () => { revision++; void refresh(); });
void refresh(); setInterval(() => void refresh(), 1000);
