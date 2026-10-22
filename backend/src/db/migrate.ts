import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mysql from 'mysql2/promise';
import { env } from '../config/env';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../database/migrations');
const SEEDS_DIR = path.resolve(__dirname, '../../../database/seeds/reference');
const MARKER = /^-- @@\s*$/m;

function chunks(sql: string): string[] {
  return sql.split(MARKER).map((s) => s.trim()).filter((s) => s.length > 0);
}

export async function runMigrations(opts: { seed?: boolean } = {}): Promise<string[]> {
  const conn = await mysql.createConnection({
    host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD,
    database: env.DB_NAME, multipleStatements: true,
  });
  const applied: string[] = [];
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(190) PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
    const [doneRows] = await conn.query<any[]>('SELECT name, checksum FROM schema_migrations');
    const done = new Map<string, string>(doneRows.map((r: any) => [r.name, r.checksum]));

    for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      if (done.has(file)) {
        if (done.get(file) !== checksum) throw new Error(`Migration ${file} was modified after being applied`);
        continue;
      }
      try {
        for (const stmt of chunks(sql)) await conn.query(stmt); // MySQL DDL auto-commits; no rollback possible
      } catch (e: any) {
        if (e?.errno === 1419) {
          console.error('\nTrigger creation was refused (MySQL error 1419: binary logging is enabled and the migration account lacks required privilege).\n' +
            'Stop here and ask the database administrator to review an approved migration procedure. Do not weaken binary logging, change global trust settings, grant broad privileges, or reset a database to retry.\n');
        }
        throw e;
      }
      await conn.query('INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)', [file, checksum]);
      applied.push(file);
    }
    if (opts.seed) {
      for (const file of fs.readdirSync(SEEDS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
        await conn.query(fs.readFileSync(path.join(SEEDS_DIR, file), 'utf8'));
      }
    }
  } finally {
    await conn.end();
  }
  return applied;
}

if (require.main === module) {
  runMigrations({ seed: process.argv.includes('--seed') })
    .then((a) => { console.log(a.length ? `Applied: ${a.join(', ')}` : 'Database up to date'); })
    .catch((e) => { console.error(e); process.exit(1); });
}
