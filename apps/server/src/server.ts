import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { bridgeMessageSchema } from '@pax/shared';
import { TelemetryStore, FlightIntelligence } from '@pax/telemetry';
import { createHostedAccess, type HostedOptions } from './hosting';
import { createSessionApi } from './session-api';
import type { ConversationOptions } from './conversation';
import type { VoiceOptions } from './voice';

export function createTelemetryServer(log = (component: string, message: string, details = {}) => {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), component, message, ...details }));
}, hosted?: HostedOptions, conversationOptions: ConversationOptions = {}, voiceOptions: VoiceOptions = {}) {
  const access = hosted ? createHostedAccess(hosted) : undefined;
  const sessionApi = createSessionApi(req => !access || access.viewerAuthorized(req),
    hosted ? [hosted.publicOrigin] : ['http://127.0.0.1:5173', 'http://localhost:5173'],
    { log: (message, details) => log('OPENAI', message, details), ...conversationOptions },
    { log: message => log('VOICE', message), ...voiceOptions });
  const store = new TelemetryStore();
  const intelligence = new FlightIntelligence(log);
  const snapshot = () => {
    const state = store.snapshot();
    return { ...state, flight: intelligence.update(state) };
  };
  const http = createServer((req, res) => {
    if (req.url?.startsWith('/api/')) {
      void sessionApi(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
      return;
    }
    if (access) {
      void access.handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
      return;
    }
    res.writeHead(req.url === '/health' ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url === '/health' ? { ok: true } : { error: 'Not found' }));
  });
  http.requestTimeout = 15000;
  http.headersTimeout = 10000;
  const bridges = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const viewers = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  let bridge: WebSocket | undefined;
  let lastHeartbeat = 0;
  let lastSampleLog = 0;
  const publish = () => {
    const data = JSON.stringify(snapshot());
    for (const client of viewers.clients) {
      if (client.bufferedAmount > 64 * 1024) client.terminate();
      else if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  };
  http.on('upgrade', (req, socket, head) => {
    const path = req.url;
    // The bridge is a native client. A web page must not impersonate it.
    const origin = req.headers.origin;
    const viewerOrigin = hosted ? origin === hosted.publicOrigin :
      origin === 'http://127.0.0.1:5173' || origin === 'http://localhost:5173';
    if ((path === '/bridge' && (origin || bridge || (access && !access.bridgeAuthorized(req)))) ||
        (path === '/telemetry' && (access ? (!viewerOrigin || !access.viewerAuthorized(req)) : (origin && !viewerOrigin))) ||
        (path !== '/bridge' && path !== '/telemetry')) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const target = path === '/bridge' ? bridges : viewers;
    target.handleUpgrade(req, socket, head, client => target.emit('connection', client, req));
  });
  bridges.on('connection', client => {
    bridge = client;
    lastHeartbeat = Date.now();
    lastSampleLog = 0;
    store.connect();
    log('BRIDGE', 'Client connected');
    publish();
    client.on('error', error => log('BRIDGE', 'Socket error', { error: error.message }));
    client.on('message', (data, binary) => {
      try {
        if (binary) throw new Error('Expected JSON text');
        const message = bridgeMessageSchema.parse(JSON.parse(data.toString()));
        const wasConnected = store.snapshot().simulatorConnected;
        lastHeartbeat = Date.now();
        store.receive(message);
        if (wasConnected !== message.simulatorConnected)
          log('SIMCONNECT', message.simulatorConnected ? 'Connected to MSFS' : 'Disconnected from MSFS');
        if (message.telemetry && Date.now() - lastSampleLog > 10000) {
          lastSampleLog = Date.now();
          log('SERVER', 'Telemetry received', { sampleTimestamp: message.telemetry.timestamp });
        }
        publish();
      } catch {
        log('BRIDGE', 'Invalid protocol message; closing connection');
        client.close(1008, 'Invalid bridge message');
        client.terminate();
      }
    });
    client.on('close', () => {
      if (bridge !== client) return;
      bridge = undefined;
      store.disconnect();
      log('BRIDGE', 'Client disconnected');
      publish();
    });
  });
  viewers.on('connection', (client, req) => {
    if (access) {
      const expiryCheck = setInterval(() => {
        if (!access.viewerAuthorized(req)) client.close(1008, 'Sign in again');
      }, 60000);
      client.once('close', () => clearInterval(expiryCheck));
    }
    log('WEB', 'Client connected');
    client.on('error', error => log('WEB', 'Socket error', { error: error.message }));
    client.send(JSON.stringify(snapshot()));
  });
  const timer = setInterval(() => {
    void sessionApi.tick();
    if (bridge && Date.now() - lastHeartbeat > 5000) {
      log('BRIDGE', 'Heartbeat timed out');
      bridge.terminate();
    }
    publish(); // Updates freshness even if no samples arrive.
  }, 1000);
  return {
    http,
    async close() {
      await sessionApi.close();
      clearInterval(timer);
      for (const client of [...bridges.clients, ...viewers.clients]) client.terminate();
      bridges.close(); viewers.close();
      await new Promise<void>((resolve, reject) => http.close(error =>
        error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve()));
    },
  };
}
