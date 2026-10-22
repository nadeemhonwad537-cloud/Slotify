/**
 * Bootstraps the first ADMIN account. No default credentials exist anywhere.
 * Usage: ADMIN_USERNAME=... ADMIN_EMAIL=... ADMIN_NAME="..." ADMIN_PASSWORD=... npm run create-admin
 */
import { withTransaction, pool } from '../db/pool';
import { hashPassword } from '../services/authService';

async function main() {
  const { ADMIN_USERNAME: u, ADMIN_EMAIL: e, ADMIN_NAME: n, ADMIN_PASSWORD: p } = process.env;
  if (!u || !e || !n || !p) throw new Error('Set ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD');
  if (p.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');
  const hash = await hashPassword(p);
  const id = await withTransaction(async (conn) => {
    const [r]: any = await conn.query('INSERT INTO users (username, email, password_hash, name) VALUES (?, ?, ?, ?)', [u, e.toLowerCase(), hash, n]);
    await conn.query("INSERT INTO user_roles (user_id, role) VALUES (?, 'ADMIN')", [r.insertId]);
    return r.insertId;
  });
  console.log(`Created ADMIN user '${u}' (id ${id})`);
}
main().catch((err) => { console.error(err.message ?? err); process.exitCode = 1; }).finally(() => pool.end());
