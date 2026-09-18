// DB를 비우고 스키마 + 데모 seed를 다시 넣는다. 로컬 PGlite는 서버를 끈 뒤 실행할 것.
import { loadConfig, loadEnvFile } from '../src/config.js';
import { openDb, resetDb } from '../src/db.js';

loadEnvFile();
const config = loadConfig();

if (config.databaseUrl && !process.argv.includes('--force')) {
  console.error('DATABASE_URL(원격 DB)이 설정되어 있습니다. 전체 데이터를 지우려면: npm run db:reset -- --force');
  process.exit(1);
}

const db = await openDb({ databaseUrl: config.databaseUrl, dataDir: config.pgliteDir });
await resetDb(db);
await db.close();
console.log(`DB 초기화 + 데모 seed 완료 (${db.kind})`);
