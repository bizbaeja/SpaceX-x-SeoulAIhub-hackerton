import { createAiService } from './ai/index.js';
import { createApp } from './app.js';
import { createProvider, loadConfig, loadEnvFile } from './config.js';
import { migrate, openDb } from './db.js';

loadEnvFile();
const config = loadConfig();

const db = await openDb({ databaseUrl: config.databaseUrl, dataDir: config.pgliteDir });
const { seeded } = await migrate(db);
const ai = createAiService(createProvider(config));
const app = createApp({ db, ai }, { logRequests: true });

const server = app.listen(config.port, () => {
  console.log(`[api] http://localhost:${config.port}/api`);
  console.log(`[db]  ${db.kind === 'pglite' ? `PGlite (${config.pgliteDir})` : 'Postgres (DATABASE_URL)'}${seeded ? ' — 데모 seed 적재' : ''}`);
  console.log(`[ai]  ${ai.provider}`);
});

const shutdown = () => {
  server.close();
  db.close().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
