import { z } from 'zod';

export const DATA_STATUSES = ['VERIFIED', 'VERIFY', 'DISCREPANCY', 'RESOLVED', 'SYNTHETIC'] as const;
export const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

export const dataStatus = z.enum(DATA_STATUSES);
export const dayName = z.enum(DAYS);
export const availabilityType = z.enum(['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN']);

/** Foreign-key id inside a JSON body (strict number, no string coercion). */
export const fk = z.number().int().positive();
/** Id taken from a URL parameter or query string. */
export const paramId = z.coerce.number().int().positive();

export const bool = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform((v) => (v ? 1 : 0));
export const queryBool = z.enum(['0', '1', 'true', 'false']).transform((v) => (v === '1' || v === 'true' ? 1 : 0));

const validDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine(validDate, 'Not a real calendar date');

/** HH:MM or HH:MM:SS, normalised to HH:MM:SS so string comparison orders times correctly. */
export const timeStr = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Use HH:MM or HH:MM:SS (24-hour)')
  .transform((s) => (s.length === 5 ? `${s}:00` : s));

export const text = (max: number) => z.string().trim().min(1).max(max);
export const optText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
