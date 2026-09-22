import { z } from 'zod';
import { voiceOwnerSchema, voiceStartSchema, type FlightSession } from '@pax/shared';
import { buildPassengerContext, ConversationError } from './conversation';

export type VoiceCall = { sdp: string; close: () => Promise<void> };
export type VoiceProvider = (sdp: string, instructions: string) => Promise<VoiceCall>;
export type VoiceOptions = { provider?: VoiceProvider; now?: () => number; log?: (message: string) => void };

export function createVoiceProvider(key: string | undefined, model = 'gpt-realtime', fetcher: typeof fetch = fetch): VoiceProvider | undefined {
  if (!key?.trim()) return undefined;
  return async (sdp, instructions) => {
    const body = new FormData();
    body.set('sdp', sdp);
    body.set('session', JSON.stringify({ type: 'realtime', model, instructions,
      output_modalities: ['audio'], max_output_tokens: 512,
      audio: { input: { turn_detection: null }, output: { voice: 'marin' } },
      truncation: { type: 'retention_ratio', retention_ratio: 0.8, token_limits: { post_instructions: 6000 } },
    }));
    const response = await fetcher('https://api.openai.com/v1/realtime/calls', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body, signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ConversationError(response.status === 429 ? 429 : 502,
        'Voice connection failed. Check the server API key, realtime model access and API quota.');
    }
    // Extract only an ID, never follow an arbitrary upstream URL with credentials.
    const location = response.headers.get('location') ?? '';
    const callId = /\/realtime\/calls\/([A-Za-z0-9_-]+)$/.exec(location)?.[1];
    if (!callId) { await response.body?.cancel(); throw new ConversationError(502, 'Voice provider did not return a manageable call.'); }
    const close = async () => {
      const result = await fetcher(`https://api.openai.com/v1/realtime/calls/${callId}/hangup`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000),
      });
      await result.body?.cancel();
      if (!result.ok && result.status !== 404) throw new Error('Voice hangup failed');
    };
    try {
      const answer = z.string().min(1).max(100000).startsWith('v=0').parse(await response.text());
      return { sdp: answer, close };
    } catch {
      await close().catch(() => {});
      throw new ConversationError(502, 'Voice provider returned an invalid connection answer.');
    }
  };
}

type Lease = { sessionId: string; connectionId: string; expiresAt: number; startedAt: number; call?: VoiceCall };
export class VoiceStore {
  private lease?: Lease;
  private readonly now: () => number;
  constructor(private readonly options: VoiceOptions = {}) { this.now = options.now ?? Date.now; }
  snapshot() { return { configured: !!this.options.provider, active: !!this.lease }; }
  private async dispose(call: VoiceCall) {
    // One bounded retry for a transient provider hangup failure.
    try { await call.close(); }
    catch { try { await call.close(); } catch { this.options.log?.('Voice hangup failed; browser peer must also close'); } }
  }
  async stop() {
    const lease = this.lease; this.lease = undefined;
    if (lease) this.options.log?.('Voice disconnected');
    if (lease?.call) await this.dispose(lease.call);
  }
  async expire() {
    if (this.lease && (this.now() >= this.lease.expiresAt || this.now() - this.lease.startedAt >= 20 * 60000)) await this.stop();
  }
  async start(session: FlightSession | null, value: unknown, textBusy: boolean) {
    const input = voiceStartSchema.parse(value);
    if (!session || session.id !== input.sessionId) throw new ConversationError(409, 'Start a flight session before connecting voice.');
    if (this.lease || textBusy) throw new ConversationError(409, 'A conversation is already active. Disconnect voice or wait for the text reply.');
    if (!this.options.provider) throw new ConversationError(503, 'Voice needs OPENAI_API_KEY in the server environment.');
    const lease: Lease = { sessionId: input.sessionId, connectionId: input.connectionId, startedAt: this.now(), expiresAt: this.now() + 45000 };
    this.lease = lease;
    this.options.log?.('Voice connecting');
    try {
      const call = await this.options.provider(input.sdp, buildPassengerContext(session));
      if (this.lease !== lease) {
        await this.dispose(call);
        throw new ConversationError(409, 'The session or voice connection ended while connecting.');
      }
      lease.call = call; lease.expiresAt = this.now() + 15000;
      this.options.log?.('Voice connected');
      return { sdp: call.sdp };
    } catch (error) {
      if (this.lease === lease) this.lease = undefined;
      if (error instanceof ConversationError) throw error;
      throw new ConversationError(502, 'Could not connect voice. Please try again.');
    }
  }
  async control(value: unknown, stop: boolean) {
    const input = voiceOwnerSchema.parse(value);
    if (!this.lease || this.lease.sessionId !== input.sessionId || this.lease.connectionId !== input.connectionId)
      throw new ConversationError(409, 'That voice connection is no longer active.');
    if (stop) await this.stop();
    else this.lease.expiresAt = this.now() + 15000;
    return this.snapshot();
  }
}
