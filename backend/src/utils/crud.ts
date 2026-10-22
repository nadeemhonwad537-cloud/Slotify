import { Router } from 'express';
import { PoolConnection } from 'mysql2/promise';
import { z, ZodObject, ZodTypeAny } from 'zod';
import { pool, withTransaction } from '../db/pool';
import { requirePermission } from '../middleware/auth';
import { ok } from '../middleware/error';
import { audit } from '../services/audit';
import { HttpError } from './errors';
import { paramId } from './zodHelpers';

export type Row = Record<string, any>;
export interface HookCtx {
  conn: PoolConnection;
  /** Validated request fields only. */
  data: Row;
  /** Current row on update, null on create. */
  existing: Row | null;
  /** existing + data (what the row will look like). */
  merged: Row;
}
/** Business-rule hook. Runs inside the write transaction. May return derived columns to store. */
export type Hook = (ctx: HookCtx) => Promise<Row | void>;

export interface ResourceConfig {
  path: string;
  table: string;
  pk: string;
  /** Developer-defined constant (never user input). */
  orderBy: string;
  create: ZodObject<any>;
  /** Fields that cannot change after creation (re-parenting needs delete + recreate). */
  immutable?: string[];
  noUpdate?: boolean;
  noDelete?: boolean;
  /** Query-string filters: column name -> Zod type. */
  filters?: Record<string, ZodTypeAny>;
  readPermissions?: string[];
  hook?: Hook;
}

export const rule = (code: string, message: string) => new HttpError(422, message, code);
export const missingRef = (what: string) => new HttpError(422, `Referenced ${what} does not exist`, 'BAD_REFERENCE');

export async function one(conn: PoolConnection, table: string, pk: string, id: unknown): Promise<Row | null> {
  const [rows]: any = await conn.query('SELECT * FROM ?? WHERE ?? = ?', [table, pk, id]);
  return rows[0] ?? null;
}

const stripUndefined = (o: Row) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** Builds list/get/create/patch/delete routes for one master-data table. Auth is applied by the caller. */
export function crudRouter(cfg: ResourceConfig): Router {
  const r = Router();
  const filters = cfg.filters ?? {};
  const readPerms = cfg.readPermissions ?? ['masterdata:read'];
  const canWrite = requirePermission('masterdata:write');

  const listQuery = z
    .object({
      ...Object.fromEntries(Object.entries(filters).map(([k, v]) => [k, v.optional()])),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .strict();
  const createSchema = cfg.create.strict();
  const updateSchema = cfg.create.omit(Object.fromEntries((cfg.immutable ?? []).map((k) => [k, true])) as any).partial().strict();

  r.get('/', requirePermission(...readPerms), async (req, res, next) => {
    try {
      const q: Row = listQuery.parse(req.query);
      const cols = Object.keys(filters).filter((k) => q[k] !== undefined);
      const where = cols.length ? `WHERE ${cols.map(() => '?? = ?').join(' AND ')}` : '';
      const wp = cols.flatMap((k) => [k, q[k]]);
      const [rows]: any = await pool.query(`SELECT * FROM ?? ${where} ORDER BY ${cfg.orderBy} LIMIT ? OFFSET ?`, [cfg.table, ...wp, q.limit, q.offset]);
      const [[c]]: any = await pool.query(`SELECT COUNT(*) AS total FROM ?? ${where}`, [cfg.table, ...wp]);
      res.json({ ...ok(rows), meta: { total: c.total, limit: q.limit, offset: q.offset } });
    } catch (e) { next(e); }
  });

  r.get('/:id', requirePermission(...readPerms), async (req, res, next) => {
    try {
      const id = paramId.parse(req.params.id);
      const [rows]: any = await pool.query('SELECT * FROM ?? WHERE ?? = ?', [cfg.table, cfg.pk, id]);
      if (!rows[0]) throw new HttpError(404, 'Record not found', 'NOT_FOUND');
      res.json(ok(rows[0]));
    } catch (e) { next(e); }
  });

  r.post('/', canWrite, async (req, res, next) => {
    try {
      const data: Row = stripUndefined(createSchema.parse(req.body));
      const row = await withTransaction(async (conn) => {
        const derived = (await cfg.hook?.({ conn, data, existing: null, merged: { ...data } })) ?? {};
        const [ins]: any = await conn.query('INSERT INTO ?? SET ?', [cfg.table, { ...data, ...derived }]);
        await audit(conn, req.user?.userId ?? null, 'MASTERDATA_CREATED', cfg.table, ins.insertId, { resource: cfg.path, fields: Object.keys(data) });
        return one(conn, cfg.table, cfg.pk, ins.insertId);
      });
      res.status(201).json(ok(row));
    } catch (e) { next(e); }
  });

  if (cfg.noUpdate) {
    r.patch('/:id', canWrite, (_req, _res, next) =>
      next(new HttpError(405, 'This record cannot be modified; delete it and create a new one', 'METHOD_NOT_ALLOWED')));
  } else {
    r.patch('/:id', canWrite, async (req, res, next) => {
      try {
        const id = paramId.parse(req.params.id);
        const data: Row = stripUndefined(updateSchema.parse(req.body));
        if (Object.keys(data).length === 0) throw new HttpError(400, 'No updatable fields supplied', 'EMPTY_UPDATE');
        const row = await withTransaction(async (conn) => {
          const [locked]: any = await conn.query('SELECT * FROM ?? WHERE ?? = ? FOR UPDATE', [cfg.table, cfg.pk, id]);
          const existing: Row | undefined = locked[0];
          if (!existing) throw new HttpError(404, 'Record not found', 'NOT_FOUND');
          const derived = (await cfg.hook?.({ conn, data, existing, merged: { ...existing, ...data } })) ?? {};
          await conn.query('UPDATE ?? SET ? WHERE ?? = ?', [cfg.table, { ...data, ...derived }, cfg.pk, id]);
          await audit(conn, req.user?.userId ?? null, 'MASTERDATA_UPDATED', cfg.table, id, { resource: cfg.path, fields: Object.keys(data) });
          return one(conn, cfg.table, cfg.pk, id);
        });
        res.json(ok(row));
      } catch (e) { next(e); }
    });
  }

  if (cfg.noDelete) {
    r.delete('/:id', canWrite, (_req, _res, next) =>
      next(new HttpError(405, 'This record cannot be deleted; archive or deactivate it using its supported status', 'METHOD_NOT_ALLOWED')));
  } else {
    r.delete('/:id', canWrite, async (req, res, next) => {
      try {
        const id = paramId.parse(req.params.id);
        await withTransaction(async (conn) => {
          const [result]: any = await conn.query('DELETE FROM ?? WHERE ?? = ?', [cfg.table, cfg.pk, id]);
          if (result.affectedRows === 0) throw new HttpError(404, 'Record not found', 'NOT_FOUND');
          await audit(conn, req.user?.userId ?? null, 'MASTERDATA_DELETED', cfg.table, id, { resource: cfg.path });
        });
        res.json(ok({ deleted: id }));
      } catch (e) { next(e); }
    });
  }

  return r;
}
