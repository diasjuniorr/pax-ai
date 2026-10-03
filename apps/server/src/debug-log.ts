import { randomUUID } from 'node:crypto';
import { debugDetails, type DebugEntry } from '@pax/shared';
export class DebugLog {
  private entries: DebugEntry[] = [];
  private sequence = 0;
  private readonly instance = randomUUID();
  append(component: string, message: string, details: Record<string, unknown> = {}) {
    const entry: DebugEntry = { id: `${this.instance}:${++this.sequence}`, timestamp: Date.now(), source: 'server',
      component: component.slice(0, 40), message: message.slice(0, 300),
      level: /failed|error|invalid/i.test(message) ? 'error' : /suppressed|discarded|timeout|stale/i.test(`${message} ${details.status ?? ''}`) ? 'warn' : 'info',
      details: debugDetails(details) };
    this.entries.push(entry); this.entries = this.entries.slice(-500);
  }
  snapshot() { return { entries: this.entries.map(entry => ({ ...entry, details: { ...entry.details } })) }; }
}
