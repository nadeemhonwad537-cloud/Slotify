import mysql from 'mysql2/promise';
import { env } from '../config/env';

/** Drops every table in the configured database. Refuses to run in production. */
export async function resetDatabase(): Promise<void> {
  if (env.NODE_ENV === 'production') throw new Error('Refusing to reset a production database');
  const conn = await mysql.createConnection({
    host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
  });
  try {
    const [rows] = await conn.query<any[]>(
      "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'");
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const r of rows) await conn.query(`DROP TABLE IF EXISTS \`${r.t}\``);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  resetDatabase().then(() => console.log(`Reset ${env.DB_NAME}`)).catch((e) => { console.error(e); process.exit(1); });
}
