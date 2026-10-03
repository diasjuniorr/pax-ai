import { debugDetails, debugLogSchema, type DebugEntry } from '@pax/shared';
const list = document.getElementById('debug-entries')!;
const component = document.getElementById('debug-component') as HTMLSelectElement;
const level = document.getElementById('debug-level') as HTMLSelectElement;
const search = document.getElementById('debug-search') as HTMLInputElement;
const follow = document.getElementById('debug-follow') as HTMLInputElement;
const status = document.getElementById('debug-status')!;
const feedback = document.getElementById('debug-feedback')!;
let entries: DebugEntry[] = [], known = new Set<string>(), polling = false;
let revision = 0, serverInstance = '', lastRendered = '';
const browserId = crypto.randomUUID();
const serverCursors = new Map<string, number>();
function text(entry: DebugEntry) {
  const details = Object.entries(entry.details).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(' ');
  return `${new Date(entry.timestamp).toISOString()} [${entry.source}] ${entry.level.toUpperCase()} ${entry.component} ${entry.message}${details ? ' | ' + details : ''}`;
}
function filtered() {
  const query = search.value.toLowerCase();
  return entries.filter(e => (!component.value || e.component === component.value) && (!level.value || e.level === level.value)
    && (!query || text(e).toLowerCase().includes(query)));
}
async function copy(value: string) {
  try { await navigator.clipboard.writeText(value); feedback.textContent = 'Copied.'; }
  catch { feedback.textContent = 'Clipboard unavailable. Select the log text to copy manually, or download JSON.'; }
}
function render() {
  const visible = filtered();
  const key = JSON.stringify(visible);
  if (key === lastRendered) return;
  lastRendered = key;
  const scroll = list.scrollTop;
  list.replaceChildren(...visible.map(entry => {
    const row = document.createElement('li'); row.dataset.level = entry.level;
    const line = document.createElement('code'); line.textContent = text(entry);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = 'Copy';
    button.setAttribute('aria-label', `Copy ${entry.component} ${entry.message}`);
    button.addEventListener('click', () => void copy(text(entry)));
    row.append(line, button); return row;
  }));
  if (!visible.length) { const empty = document.createElement('li'); empty.textContent = 'No matching application events.'; list.append(empty); }
  list.scrollTop = follow.checked ? list.scrollHeight : scroll;
}
function append(incoming: DebugEntry[]) {
  for (const entry of incoming) if (!known.has(entry.id)) { entries.push(entry); known.add(entry.id); }
  entries.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id, undefined, { numeric: true }));
  entries = entries.slice(-500);
  // Keep a bounded dedup set larger than a full server snapshot, including entries trimmed from the mixed view.
  if (known.size > 1500) known = new Set([...known].slice(-1000));
  const selected = component.value;
  const names = [...new Set(entries.map(e => e.component))].sort();
  if (selected && !names.includes(selected)) names.push(selected);
  if (JSON.stringify(names) !== component.dataset.names) {
    component.dataset.names = JSON.stringify(names);
    component.replaceChildren(new Option('All components', ''), ...names.map(name => new Option(name, name)));
    component.value = selected;
  }
  render();
}
export function debugEvent(componentName: string, message: string, details: Record<string, unknown> = {}, severity: DebugEntry['level'] = 'info') {
  append([{ id: `${browserId}:${++revision}`, source: 'browser', timestamp: Date.now(), component: componentName,
    level: severity, message: message.slice(0, 300), details: debugDetails(details) }]);
}
for (const control of [component, level, search]) control.addEventListener('input', render);
follow.addEventListener('change', () => { if (follow.checked) list.scrollTop = list.scrollHeight; });
document.getElementById('debug-copy')!.addEventListener('click', () => void copy(filtered().map(text).join('\n')));
document.getElementById('debug-download')!.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'pax-debug-log-v1', exportedAt: new Date().toISOString(),
    filters: { component: component.value, level: level.value, search: search.value }, entries: filtered() }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'pax-debug-log.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
async function refresh() {
  if (polling) return;
  polling = true;
  try {
    const response = await fetch('/api/debug-log', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Unavailable');
    const data = debugLogSchema.parse(await response.json());
    const instance = data.entries[0]?.id.split(':')[0] ?? '';
    if (serverInstance && instance && instance !== serverInstance) debugEvent('WEB', 'Server restarted; earlier server history is no longer available', {}, 'warn');
    if (instance) serverInstance = instance;
    const fresh = data.entries.filter(entry => {
      const [instance, sequence] = entry.id.split(':');
      const value = Number(sequence);
      if (!instance || !Number.isFinite(value) || value <= (serverCursors.get(instance) ?? 0)) return false;
      serverCursors.set(instance, value); return true;
    });
    if (serverCursors.size > 4) serverCursors.delete(serverCursors.keys().next().value!);
    append(fresh);
    status.textContent = `Updated ${new Date().toLocaleTimeString()} · ${entries.length}/500 retained · server logs + this tab's voice events`;
  } catch { status.textContent = 'Server log unavailable; showing retained entries. Retrying…'; }
  finally { polling = false; }
}
void refresh(); setInterval(() => void refresh(), 2000);
