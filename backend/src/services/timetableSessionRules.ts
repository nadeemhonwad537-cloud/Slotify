import { z } from 'zod';
import { fk } from '../utils/zodHelpers';
import type { ValidationIssue } from './validationService';

export const timetableSessionInput = z.object({
  offering_id: fk,
  audience_id: fk,
  room_id: fk,
  start_slot_id: fk,
  assignment_ids: z.array(fk).min(1).max(20),
}).strict().superRefine((input, context) => {
  if (new Set(input.assignment_ids).size !== input.assignment_ids.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['assignment_ids'],
      message: 'A faculty assignment may only be selected once.',
    });
  }
});

export interface TeachingSlot {
  day: string;
  slot_id: number;
  slot_no: number;
  start_time: string;
  end_time: string;
}

export interface SessionSlotOption {
  day: string;
  start_slot_id: number;
  slot_count: number;
  start_time: string;
  end_time: string;
}

export function getContiguousSlotOptions(
  slots: TeachingSlot[],
  periodCount: number,
): SessionSlotOption[] {
  if (!Number.isInteger(periodCount) || periodCount < 1) return [];
  const slotsByDay = new Map<string, TeachingSlot[]>();
  for (const slot of slots) {
    const daySlots = slotsByDay.get(slot.day) ?? [];
    daySlots.push(slot);
    slotsByDay.set(slot.day, daySlots);
  }

  const options: SessionSlotOption[] = [];
  for (const [day, daySlots] of slotsByDay) {
    daySlots.sort((a, b) => a.slot_no - b.slot_no);
    for (let start = 0; start + periodCount <= daySlots.length; start += 1) {
      const block = daySlots.slice(start, start + periodCount);
      if (block.some((slot, index) => index > 0 && (
        slot.slot_no !== block[index - 1].slot_no + 1 ||
        slot.start_time !== block[index - 1].end_time
      ))) continue;
      options.push({
        day,
        start_slot_id: block[0].slot_id,
        slot_count: periodCount,
        start_time: block[0].start_time,
        end_time: block[block.length - 1].end_time,
      });
    }
  }
  return options;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function issueKey(issue: ValidationIssue): string {
  return `${issue.rule_code}:${stableJson(issue.details)}`;
}

export function findNewValidationErrors(
  previous: ValidationIssue[],
  next: ValidationIssue[],
): ValidationIssue[] {
  const previousErrors = new Set(
    previous.filter(issue => issue.severity === 'ERROR').map(issueKey),
  );
  return next.filter(issue =>
    issue.severity === 'ERROR' && !previousErrors.has(issueKey(issue)),
  );
}

export function findSessionValidationErrors(
  issues: ValidationIssue[],
  sessionId: number,
): ValidationIssue[] {
  function referencesSession(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(referencesSession);
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, nested]) => {
      if (key === 'session_id' && Number(nested) === sessionId) return true;
      if (key === 'session_ids' && Array.isArray(nested) && nested.some(id => Number(id) === sessionId)) return true;
      return referencesSession(nested);
    });
  }
  return issues.filter(issue => issue.severity === 'ERROR' && referencesSession(issue.details));
}
