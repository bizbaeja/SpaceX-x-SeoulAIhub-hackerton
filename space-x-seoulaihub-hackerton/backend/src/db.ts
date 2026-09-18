import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

// DATABASE_URL(Supabase Postgres)이 있으면 pg, 없으면 로컬 PGlite(임베디드 Postgres)를 쓴다.
// 두 드라이버 모두 같은 SQL/파라미터($1) 문법을 쓰므로 쿼리 코드는 공유된다.
export interface Db {
  kind: 'postgres' | 'pglite';
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export async function openDb(opts: { databaseUrl?: string; dataDir?: string }): Promise<Db> {
  if (opts.databaseUrl) {
    const isLocal = /localhost|127\.0\.0\.1/.test(opts.databaseUrl);
    const pool = new pg.Pool({
      connectionString: opts.databaseUrl,
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
    });
    return {
      kind: 'postgres',
      query: async (sql, params) => (await pool.query(sql, params)).rows,
      exec: async (sql) => {
        await pool.query(sql);
      },
      close: () => pool.end(),
    };
  }

  // dataDir 미지정 시 인메모리 (테스트용)
  const lite = await PGlite.create(opts.dataDir ?? 'memory://');
  return {
    kind: 'pglite',
    query: async <T>(sql: string, params?: unknown[]) => (await lite.query<T>(sql, params)).rows,
    exec: async (sql) => {
      await lite.exec(sql);
    },
    close: () => lite.close(),
  };
}

const DB_DIR = new URL('../db/', import.meta.url);

/**
 * db/schema.sql → db/schema.*.sql 순서로 읽는다. (seed도 동일)
 * 다른 파트(예: Referral)는 db/schema.referrals.sql, db/seed.referrals.sql 을 추가하면 함께 적용된다.
 */
async function readSqlFiles(kind: 'schema' | 'seed'): Promise<string[]> {
  const names = (await readdir(DB_DIR))
    .filter((n) => n === `${kind}.sql` || (n.startsWith(`${kind}.`) && n.endsWith('.sql')))
    .sort((a, b) => (a === `${kind}.sql` ? -1 : b === `${kind}.sql` ? 1 : a.localeCompare(b)));
  return Promise.all(names.map((n) => readFile(new URL(n, DB_DIR), 'utf8')));
}

/** 스키마를 보장하고, 기관 데이터가 비어 있으면 데모 seed를 넣는다. */
export async function migrate(db: Db): Promise<{ seeded: boolean }> {
  for (const sql of await readSqlFiles('schema')) await db.exec(sql);
  const [{ n }] = await db.query<{ n: number }>('select count(*)::int as n from organizations');
  if (n > 0) return { seeded: false };
  for (const sql of await readSqlFiles('seed')) await db.exec(sql);
  return { seeded: true };
}

export async function resetDb(db: Db): Promise<void> {
  await db.exec(
    'drop table if exists referral_logs, referrals, case_profiles, cases, services, organizations cascade;',
  );
  await migrate(db);
}
