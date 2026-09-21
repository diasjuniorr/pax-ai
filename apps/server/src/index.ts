import { createTelemetryServer } from './server';
import { resolve } from 'node:path';
const production = process.env.NODE_ENV === 'production';
const host = production ? '0.0.0.0' : '127.0.0.1';
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const server = createTelemetryServer(undefined, production ? {
  publicOrigin: process.env.PAX_PUBLIC_ORIGIN ?? process.env.RENDER_EXTERNAL_URL ?? '',
  bridgeToken: process.env.PAX_BRIDGE_TOKEN ?? '',
  dashboardToken: process.env.PAX_DASHBOARD_TOKEN ?? '',
  staticDirectory: resolve('apps/web/dist'),
} : undefined);
server.http.on('error', error => { console.error(error); process.exitCode = 1; void server.close(); });
server.http.listen(port, host, () => {
  console.log(JSON.stringify({ component: 'SERVER', message: 'Listening', address: `${host}:${port}`, authenticated: production }));
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void server.close().then(() => process.exit(0)); });
}
