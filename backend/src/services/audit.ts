import { PoolConnection } from 'mysql2/promise';

/** Writes one audit row inside the caller's transaction, so the log and the change commit or roll back together. */
export async function audit(conn: PoolConnection, actorUserId: number | null, action: string, table: string, recordId: number | null, details?: object) {
  await conn.query('INSERT INTO audit_logs (actor_user_id, action, table_name, record_id, details) VALUES (?, ?, ?, ?, ?)',
    [actorUserId, action, table, recordId, details ? JSON.stringify(details) : null]);
}
