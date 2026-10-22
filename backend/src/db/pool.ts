import mysql, { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { env } from '../config/env';

export const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
  timezone: 'Z',
});

/** Parameterized SELECT. Never concatenate user input into `sql`. */
export async function query<T extends RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await pool.query<T[]>(sql, params as any[]);
  return rows;
}

export async function exec(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const [res] = await pool.query<ResultSetHeader>(sql, params as any[]);
  return res;
}

/** Runs fn in a transaction; commits on success, rolls back on any error. */
export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
