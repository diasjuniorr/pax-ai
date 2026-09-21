import { createTelemetryServer } from './server';
const server = createTelemetryServer();
server.http.on('error', error => { console.error(error); process.exitCode = 1; void server.close(); });
server.http.listen(3001, '127.0.0.1', () => {
  console.log(JSON.stringify({ component: 'SERVER', message: 'Listening', address: '127.0.0.1:3001' }));
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void server.close().then(() => process.exit(0)); });
}
