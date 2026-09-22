import { flightSessionInputSchema, flightSessionStateSchema, passengerProfileSchema, type FlightSession, type PassengerProfile } from '@pax/shared';
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const fields = document.getElementById('session-fields') as HTMLFieldSetElement;
const end = document.getElementById('end-session') as HTMLButtonElement;
const status = document.getElementById('session-status')!;
const summary = document.getElementById('session-summary')!;
const error = document.getElementById('session-error')!;
let session: FlightSession | null = null;
let busy = false;
let available = false;
let revision = 0;
function controls() { fields.disabled = busy || !available || !!session; end.hidden = !session; end.disabled = busy || !available; }
function populate(profile: PassengerProfile) {
  for (const [id, value] of Object.entries({ name: profile.name, age: profile.age, gender: profile.gender,
    occupation: profile.occupation, reason: profile.tripReason, traits: profile.personalityTraits.join(', '), disposition: profile.flightDisposition })) {
    field(`passenger-${id}`).value = String(value);
  }
}
function render(value: unknown) {
  const next = flightSessionStateSchema.parse(value).session;
  if (next && next.id !== session?.id) {
    populate(next.passenger);
    field('flight-duration').value = String(next.expectedDurationMinutes);
    field('flight-origin').value = next.origin ?? '';
    field('flight-destination').value = next.destination ?? '';
  }
  session = next;
  available = true;
  status.textContent = session ? 'Session active' : 'No active session';
  summary.textContent = session ? `${session.passenger.name} · ${session.expectedDurationMinutes} minutes · ${session.origin ?? 'Origin not set'} → ${session.destination ?? 'Destination not set'} · Started ${new Date(session.startedAt).toLocaleTimeString()}` : '';
  controls();
}
async function request(path: string, data?: unknown) {
  const response = await fetch(path, data === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const value = await response.json();
  if (response.status === 401) { location.reload(); throw new Error('Please sign in again.'); }
  if (!response.ok) throw new Error(value.error ?? 'Could not save the session.');
  return value;
}
async function refresh() {
  if (busy) return;
  const current = revision;
  try { const state = await request('/api/session'); if (current === revision) render(state); }
  catch { if (current === revision) { available = false; status.textContent = 'Session connection unavailable; retrying'; controls(); } }
}
async function mutate(work: () => Promise<void>) {
  if (busy) return;
  busy = true; revision++; error.textContent = ''; controls();
  try { await work(); } catch (failure) { error.textContent = failure instanceof Error ? failure.message : 'Something went wrong.'; }
  finally { busy = false; controls(); await refresh(); }
}
document.getElementById('random-passenger')!.addEventListener('click', () => void mutate(async () => {
  const value = await request('/api/passenger/random', {});
  populate(passengerProfileSchema.parse(value.passenger));
}));
document.getElementById('session-form')!.addEventListener('submit', event => {
  event.preventDefault();
  const input = flightSessionInputSchema.safeParse({ passenger: {
    name: field('passenger-name').value, age: Number(field('passenger-age').value),
    gender: field('passenger-gender').value, occupation: field('passenger-occupation').value,
    tripReason: field('passenger-reason').value,
    personalityTraits: field('passenger-traits').value.split(',').map(value => value.trim()),
    flightDisposition: field('passenger-disposition').value,
  }, expectedDurationMinutes: Number(field('flight-duration').value),
  origin: field('flight-origin').value.trim() || undefined, destination: field('flight-destination').value.trim() || undefined });
  if (!input.success) { error.textContent = input.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '); return; }
  void mutate(async () => render(await request('/api/session', input.data)));
});
end.addEventListener('click', () => { if (session) { const id = session.id; void mutate(async () => render(await request('/api/session/end', { id }))); } });
controls(); void refresh(); setInterval(() => void refresh(), 3000);
