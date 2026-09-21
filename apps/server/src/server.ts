import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { bridgeMessageSchema } from '@pax/shared';
import { TelemetryStore } from '@pax/telemetry';

export function createTelemetryServer(log = (component: string, message: string, details = {}) => {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), component, message, ...details }));
}) {
  const store = new TelemetryStore();
  const http = createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url === '/health' ? { ok: true } : { error: 'Not found' }));
  });
  const bridges = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const viewers = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  let bridge: WebSocket | undefined;
  let lastHeartbeat = 0;
  let lastSampleLog = 0;
  const publish = () => {
    const data = JSON.stringify(store.snapshot());
    for (const client of viewers.clients) {
      if (client.bufferedAmount > 64 * 1024) client.terminate();
      else if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  };
  http.on('upgrade', (req, socket, head) => {
    const path = req.url;
    // The bridge is a native client. A web page must not impersonate it.
    const origin = req.headers.origin;
    const viewerOrigin = origin === 'http://127.0.0.1:5173' || origin === 'http://localhost:5173';
    if ((path === '/bridge' && (origin || bridge)) ||
        (path === '/telemetry' && origin && !viewerOrigin) ||
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
  viewers.on('connection', client => {
    log('WEB', 'Client connected');
    client.on('error', error => log('WEB', 'Socket error', { error: error.message }));
    client.send(JSON.stringify(store.snapshot()));
  });
  const timer = setInterval(() => {
    if (bridge && Date.now() - lastHeartbeat > 5000) {
      log('BRIDGE', 'Heartbeat timed out');
      bridge.terminate();
    }
    publish(); // Updates freshness even if no samples arrive.
  }, 1000);
  return {
    http,
    async close() {
      clearInterval(timer);
      for (const client of [...bridges.clients, ...viewers.clients]) client.terminate();
      bridges.close(); viewers.close();
      await new Promise<void>((resolve, reject) => http.close(error =>
        error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve()));
    },
  };
}
