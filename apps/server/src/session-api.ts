import type { IncomingMessage, ServerResponse } from 'node:http';
import { z, ZodError } from 'zod';
import { FlightSessionStore, generatePassenger } from './passenger';
import { ConversationError, ConversationStore, type ConversationOptions } from './conversation';
import { VoiceStore, type VoiceOptions } from './voice';

export function createSessionApi(authorize: (req: IncomingMessage) => boolean, allowedOrigins: string[], options: ConversationOptions = {}, voiceOptions: VoiceOptions = {}) {
  const store = new FlightSessionStore();
  const conversation = new ConversationStore(options);
  const voice = new VoiceStore(voiceOptions);
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(data));
    };
    if (!authorize(req)) { send(401, { error: 'Sign in again to continue.' }); return; }
    if (req.method !== 'GET' && !allowedOrigins.includes(req.headers.origin ?? '')) {
      send(403, { error: 'Forbidden' }); return;
    }
    if (req.url === '/api/session' && req.method === 'GET') { send(200, store.snapshot()); return; }
    if (req.url === '/api/conversation' && req.method === 'GET') { send(200, { ...conversation.snapshot(), voiceActive: voice.snapshot().active }); return; }
    if (req.url === '/api/voice' && req.method === 'GET') { send(200, voice.snapshot()); return; }
    if (req.method !== 'POST') { send(405, { error: 'Method not allowed' }); return; }
    if (!['/api/session', '/api/session/end', '/api/passenger/random', '/api/conversation', '/api/voice/start', '/api/voice/heartbeat', '/api/voice/stop'].includes(req.url ?? '')) { send(404, { error: 'Not found' }); return; }
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') { send(415, { error: 'Expected JSON' }); return; }
    try {
      let body = '', bytes = 0;
      req.setEncoding('utf8');
      for await (const chunk of req) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > (req.url === '/api/voice/start' ? 128000 : 8192)) { send(413, { error: 'Request too large' }); return; }
        body += chunk.toString();
      }
      const data: unknown = JSON.parse(body);
      if (req.url === '/api/voice/start') {
        send(200, await voice.start(store.snapshot().session, data, conversation.snapshot().status === 'processing')); return;
      }
      if (req.url === '/api/voice/heartbeat' || req.url === '/api/voice/stop') {
        send(200, await voice.control(data, req.url === '/api/voice/stop')); return;
      }
      if (req.url === '/api/conversation') {
        if (voice.snapshot().active) throw new ConversationError(409, 'Disconnect voice before sending a text message.');
        send(200, { ...await conversation.send(store.snapshot().session, data), voiceActive: false }); return;
      }
      if (req.url === '/api/passenger/random') {
        z.object({}).strict().parse(data);
        send(200, { passenger: generatePassenger() }); return;
      }
      if (req.url === '/api/session/end') {
        const { id } = z.object({ id: z.string().uuid() }).strict().parse(data);
        if (!store.end(id)) { send(409, { error: 'That session is no longer active. Refresh the session state.' }); return; }
        conversation.reset(null);
        await voice.stop();
        send(200, store.snapshot()); return;
      }
      const session = store.start(data);
      if (!session) { send(409, { error: 'A session is already active. End it before starting another.' }); return; }
      conversation.reset(session.id);
      send(201, { session });
    } catch (error) {
      if (error instanceof ConversationError) { send(error.status, { error: error.message }); return; }
      if (error instanceof ZodError || error instanceof SyntaxError) {
        send(400, { error: 'Check the submitted fields and message length (1–2000 characters).' }); return;
      }
      throw error;
    }
  };
  return Object.assign(handle, { tick: () => voice.expire(), close: async () => { conversation.reset(null); await voice.stop(); } });
}
