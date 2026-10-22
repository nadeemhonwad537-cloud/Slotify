import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../utils/errors';

// Consistent response envelope: { success: true, data } | { success: false, error: { code, message, details? } }
export function notFound(_req: Request, res: Response) {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: err.flatten().fieldErrors } });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ success: false, error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err?.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ success: false, error: { code: 'DUPLICATE', message: 'A record with these unique values already exists' } });
  }
  if (err?.code === 'ER_SIGNAL_EXCEPTION' || err?.errno === 3819 /* CHECK violated */) {
    return res.status(422).json({ success: false, error: { code: 'RULE_VIOLATION', message: err.sqlMessage ?? 'Rule violation' } });
  }
  if (err?.errno === 1451) {
    return res.status(409).json({ success: false, error: { code: 'IN_USE', message: 'This record is referenced by other records. Deactivate it instead of deleting it.' } });
  }
  if (err?.errno === 1452) {
    return res.status(422).json({ success: false, error: { code: 'BAD_REFERENCE', message: 'A referenced record does not exist or does not belong to the same parent' } });
  }
  if (err?.errno === 1264 || err?.errno === 1406 || err?.errno === 1265) {
    return res.status(400).json({ success: false, error: { code: 'BAD_VALUE', message: 'A value is out of range or too long for its column' } });
  }
  console.error(err);
  res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Internal server error' } });
}

export const ok = <T>(data: T) => ({ success: true, data });
