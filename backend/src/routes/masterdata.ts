import { Router } from 'express';
import { PoolConnection } from 'mysql2/promise';
import { z } from 'zod';
import { authenticate, requirePermission } from '../middleware/auth';
import { ok } from '../middleware/error';
import { pool, withTransaction } from '../db/pool';
import { dayLatestEnd, SATURDAY_LATEST_END } from '../rules/scheduleRules';
import { audit } from '../services/audit';
import { semesterMatchesParity, semestersForParity } from '../services/academicTermRules';
import { CurriculumBuilderPayload, validateCurriculumBuilderPayload } from '../services/curriculumBuilder';
import { assertCurriculumAudienceSections, CurriculumAudienceSection } from '../services/curriculumAudienceRules';
import {
  assertCurriculumDraftContextMatches,
  assertCurriculumDraftVersion,
  CurriculumDraftContext,
  CurriculumDraftSubject,
  curriculumDraftSubjectsSchema,
  deserializeCurriculumDraftSubjects,
  serializeCurriculumDraftSubjects,
} from '../services/curriculumDraftRules';
import { HttpError } from '../utils/errors';
import { crudRouter, Hook, missingRef, one, ResourceConfig, Row, rule } from '../utils/crud';
import {
  availabilityType, bool, dataStatus, dateStr, DATA_STATUSES, dayName, fk, optText, paramId, queryBool, text, timeStr,
} from '../utils/zodHelpers';

const code = (min: number, max: number) => z.string().trim().regex(new RegExp(`^[A-Z0-9_]{${min},${max}}$`), 'Use A-Z, 0-9 and _');
const nullableDate = dateStr.nullable().optional();
const nullableInt = z.number().int().min(0).nullable().optional();

/** Throws unless a referenced parent row exists; returns it. */
async function need(conn: PoolConnection, table: string, pk: string, id: unknown, label: string): Promise<Row> {
  const r = await one(conn, table, pk, id);
  if (!r) throw missingRef(label);
  return r;
}

async function validateBuilderContext(conn: PoolConnection, payload: CurriculumDraftContext) {
  const [termRows]: any = await conn.query(
    `SELECT t.term_id, t.status, t.parity, y.is_active AS year_active
     FROM terms t JOIN academic_years y ON y.year_id = t.year_id
     WHERE t.term_id = ? AND t.year_id = ? FOR UPDATE`,
    [payload.term_id, payload.year_id]);
  const term = termRows[0];
  if (!term) throw missingRef('academic year / term combination');
  if (!term.year_active) throw rule('YEAR_INACTIVE', 'The selected academic year is inactive');
  if (term.status === 'CLOSED') throw rule('TERM_CLOSED', 'Cannot build curriculum for an archived term');

  const [curriculumRows]: any = await conn.query(
    `SELECT p.dept_id, p.is_active AS program_active, d.is_active AS department_active, cs.is_active AS scheme_active,
            s.is_active AS semester_active, s.semester_no
     FROM programs p
     JOIN departments d ON d.dept_id = p.dept_id
     JOIN curriculum_schemes cs ON cs.program_id = p.program_id
     JOIN semesters s ON s.scheme_id = cs.scheme_id
     WHERE p.program_id = ? AND cs.scheme_id = ? AND s.semester_id = ?
     FOR UPDATE`,
    [payload.program_id, payload.scheme_id, payload.semester_id]);
  const curriculum = curriculumRows[0];
  if (!curriculum) throw missingRef('program / scheme / semester combination');
  if (!curriculum.department_active || !curriculum.program_active || !curriculum.scheme_active || !curriculum.semester_active) {
    throw rule('INACTIVE_CURRICULUM', 'The selected department, program, scheme and semester must all be active');
  }
  if (!semesterMatchesParity(Number(curriculum.semester_no), term.parity)) {
    throw rule('TERM_SEMESTER_PARITY_MISMATCH', `Semester ${curriculum.semester_no} does not belong to the ${term.parity.toLowerCase()} term configuration`);
  }

  const [mappingTables]: any = await conn.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'term_program_semesters'`);
  const mappingAvailable = mappingTables.length > 0;
  if (!mappingAvailable) {
    throw rule('TERM_SEMESTER_MAPPING_REQUIRED', 'Apply migration 005 and configure this program semester for the selected term before validating or publishing curriculum');
  }
  const [mappings]: any = await conn.query(
    `SELECT is_active FROM term_program_semesters
     WHERE term_id = ? AND scheme_id = ? AND semester_id = ?`,
    [payload.term_id, payload.scheme_id, payload.semester_id]);
  if (!mappings.length) {
    throw rule('TERM_SEMESTER_NOT_CONFIGURED', 'Configure this program semester for the selected term first');
  }
  if (!mappings[0].is_active) {
    throw rule('TERM_SEMESTER_INACTIVE', 'The selected program semester is inactive for this term');
  }

  return { deptId: curriculum.dept_id, mappingAvailable };
}

async function validateBuilderSubjects(conn: PoolConnection, payload: CurriculumBuilderPayload) {
  for (const subject of payload.subjects) {
    const [duplicates]: any = await conn.query(
      `SELECT c.course_id FROM curriculum_courses cc
       JOIN courses c ON c.course_id = cc.course_id
       WHERE cc.semester_id = ? AND LOWER(TRIM(c.course_code)) = ?
       LIMIT 1 FOR UPDATE`,
      [payload.semester_id, subject.course_code.toLowerCase()]);
    if (duplicates.length) {
      throw new HttpError(409, `Subject code "${subject.course_code}" already exists in this semester`, 'DUPLICATE_SUBJECT_CODE');
    }
    for (const component of subject.components) {
      if (component.required_room_type_id != null) {
        const roomType = await need(conn, 'room_types', 'room_type_id', component.required_room_type_id, 'room type');
        if (!roomType.is_active) throw rule('ROOM_TYPE_INACTIVE', 'A component requires an active room type');
      }
    }
  }
  await validateAudienceSelections(conn, payload, payload.subjects, true);
}

async function validateAudienceSelections(
  conn: PoolConnection,
  context: CurriculumDraftContext,
  subjects: Array<Pick<CurriculumDraftSubject, 'audience_section_ids'>>,
  required: boolean,
) {
  const sectionIds = Array.from(new Set(subjects.flatMap(subject => subject.audience_section_ids)));
  let sections: CurriculumAudienceSection[] = [];
  if (sectionIds.length) {
    const [rows]: any = await conn.query(
      `SELECT sec.section_id, sec.term_id, sec.scheme_id, sec.semester_id, sec.is_active,
              t.year_id, cs.program_id
       FROM sections sec
       JOIN terms t ON t.term_id = sec.term_id
       JOIN curriculum_schemes cs ON cs.scheme_id = sec.scheme_id
       WHERE sec.section_id IN (?)
       FOR UPDATE`,
      [sectionIds],
    );
    sections = rows.map((row: any): CurriculumAudienceSection => ({
      section_id: Number(row.section_id),
      year_id: Number(row.year_id),
      term_id: Number(row.term_id),
      program_id: Number(row.program_id),
      scheme_id: Number(row.scheme_id),
      semester_id: Number(row.semester_id),
      is_active: Boolean(row.is_active),
    }));
  }
  for (const subject of subjects) {
    assertCurriculumAudienceSections(subject.audience_section_ids, sections, context, required);
  }
}

async function validateDraftAudienceSections(
  conn: PoolConnection,
  context: CurriculumDraftContext,
  subjects: CurriculumDraftSubject[],
) {
  await validateAudienceSelections(conn, context, subjects, false);
}

const curriculumDraftContextSchema = z.object({
  year_id: fk,
  term_id: fk,
  program_id: fk,
  scheme_id: fk,
  semester_id: fk,
}).strict();

const curriculumDraftInputSchema = curriculumDraftContextSchema.extend({
  subjects: curriculumDraftSubjectsSchema,
}).strict();

const curriculumDraftUpdateSchema = curriculumDraftInputSchema.extend({
  expected_version: fk,
}).strict();

async function requireCurriculumDraftTable(conn: PoolConnection) {
  const [tables]: any = await conn.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'curriculum_drafts'`,
  );
  if (!tables.length) {
    throw new HttpError(503, 'Curriculum draft persistence is unavailable until migration 009_curriculum_drafts.sql is applied', 'CURRICULUM_DRAFTS_NOT_MIGRATED');
  }
}

async function validateDraftRoomTypes(conn: PoolConnection, subjects: CurriculumDraftSubject[]) {
  const roomTypeIds = Array.from(new Set(subjects.flatMap(subject => subject.components)
    .map(component => component.required_room_type_id)
    .filter(Boolean)
    .map(Number)));
  if (!roomTypeIds.length) return;

  const [rows]: any = await conn.query(
    'SELECT room_type_id FROM room_types WHERE is_active = 1 AND room_type_id IN (?)',
    [roomTypeIds],
  );
  if (rows.length !== roomTypeIds.length) {
    throw rule('ROOM_TYPE_INACTIVE', 'Every selected required room type must exist and be active');
  }
}

function mapCurriculumDraft(row: any) {
  return {
    draft_id: Number(row.draft_id),
    year_id: Number(row.year_id),
    term_id: Number(row.term_id),
    program_id: Number(row.program_id),
    scheme_id: Number(row.scheme_id),
    semester_id: Number(row.semester_id),
    subjects: deserializeCurriculumDraftSubjects(row.draft_payload),
    version: Number(row.version),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ER_DUP_ENTRY';
}

/** Day-grid rules shared by time_slots updates and term_day_slots: closing time, Saturday cutoff, no overlaps within a day. */
async function checkDayGrid(conn: PoolConnection, termDayId: number, slot: Row, ignoreSlotId?: number) {
  const day = await need(conn, 'term_teaching_days', 'term_day_id', termDayId, 'teaching day');
  if (slot.slot_type === 'TEACHING') {
    if (!day.is_teaching_day) throw rule('NOT_A_TEACHING_DAY', `${day.day_name} is not configured as a teaching day`);
    const limit = dayLatestEnd(day.day_name, day.closing_time);
    if (limit && slot.end_time > limit) {
      throw rule(day.day_name === 'SAT' ? 'SATURDAY_AFTER_CUTOFF' : 'SLOT_AFTER_CLOSING',
        `Teaching slot ends at ${slot.end_time}, after the ${day.day_name} limit of ${limit}`);
    }
  }
  const [clash]: any = await conn.query(
    `SELECT s.slot_no FROM term_day_slots m JOIN time_slots s ON s.slot_id = m.slot_id
     WHERE m.term_day_id = ? AND m.is_active = 1 AND s.slot_id <> ? AND s.start_time < ? AND s.end_time > ? LIMIT 1`,
    [termDayId, ignoreSlotId ?? 0, slot.end_time, slot.start_time]);
  if (clash.length) throw rule('SLOT_OVERLAP', `Overlaps slot ${clash[0].slot_no} already active on ${day.day_name}`);
}

const resources: ResourceConfig[] = [];
const add = (c: ResourceConfig) => resources.push(c);

// ---------- Departments, designations, faculty ----------
add({
  path: 'departments', table: 'departments', pk: 'dept_id', orderBy: 'dept_code',
  create: z.object({ dept_code: code(2, 20), dept_name: text(150), is_active: bool.optional() }),
  immutable: [],
});

add({
  path: 'designations', table: 'designations', pk: 'designation_id', orderBy: 'designation_code',
  create: z.object({ designation_code: code(2, 40), designation_name: text(100), data_status: dataStatus.optional(), is_active: bool.optional() }),
});

add({
  path: 'faculty', table: 'faculty_profiles', pk: 'faculty_id', orderBy: 'name',
  readPermissions: ['masterdata:write', 'faculty_submission:review'], // contact details: not exposed to every reader
  create: z.object({
    user_id: fk.nullable().optional(), staff_code: optText(40), name: text(150),
    // Designation is entered/verified by an administrator. It is NEVER inferred from a name or title.
    designation_id: fk.nullable().optional(), dept_id: fk.nullable().optional(),
    employment_type: z.enum(['REGULAR', 'GUEST', 'PART_TIME', 'TA']).nullable().optional(),
    phone: optText(30), email: z.string().trim().email().max(255).nullable().optional(),
    is_active: bool.optional(), data_status: dataStatus.optional(),
  }),
  filters: { dept_id: paramId, designation_id: paramId, is_active: queryBool },
  hook: async ({ conn, merged }) => {
    if (merged.user_id) {
      const [r]: any = await conn.query("SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'FACULTY'", [merged.user_id]);
      if (!r.length) throw rule('USER_NOT_FACULTY', 'The linked user account does not have the FACULTY role');
    }
  },
});

// ---------- Academic calendar ----------
add({
  path: 'academic-years', table: 'academic_years', pk: 'year_id', orderBy: 'year_label',
  create: z.object({ year_label: text(20), start_date: nullableDate, end_date: nullableDate, is_active: bool.optional() }),
  filters: { is_active: queryBool },
  hook: async ({ conn, merged, existing }) => {
    if (merged.start_date && merged.end_date && merged.end_date < merged.start_date) {
      throw rule('YEAR_DATES', 'Academic-year end date cannot be before its start date');
    }
    if (existing && merged.is_active === 0) {
      const [activeTerms]: any = await conn.query(
        "SELECT term_id FROM terms WHERE year_id = ? AND status = 'ACTIVE' LIMIT 1",
        [existing.year_id]);
      if (activeTerms.length) {
        throw new HttpError(409, 'Archive the active terms before deactivating this academic year', 'IN_USE');
      }
    }
    if (existing && (merged.start_date !== existing.start_date || merged.end_date !== existing.end_date)) {
      const [terms]: any = await conn.query(
        'SELECT term_id, start_date, end_date FROM terms WHERE year_id = ? AND start_date IS NOT NULL AND end_date IS NOT NULL',
        [existing.year_id]);
      const outside = terms.some((term: Row) =>
        (merged.start_date && term.start_date < merged.start_date) ||
        (merged.end_date && term.end_date > merged.end_date));
      if (outside) throw rule('YEAR_CONTAINS_TERMS', 'Academic-year dates cannot exclude an existing term');
    }
  },
  noDelete: true,
});

add({
  path: 'terms', table: 'terms', pk: 'term_id', orderBy: 'year_id, term_name',
  create: z.object({
    year_id: fk, term_name: text(60), parity: z.enum(['ODD', 'EVEN']), start_date: nullableDate, end_date: nullableDate,
    status: z.enum(['DRAFT', 'ACTIVE', 'CLOSED']).optional(),
  }),
  immutable: ['year_id'],
  filters: { year_id: paramId, status: z.enum(['DRAFT', 'ACTIVE', 'CLOSED']), parity: z.enum(['ODD', 'EVEN']) },
  hook: async ({ conn, merged, existing }) => {
    const [yearRows]: any = await conn.query(
      'SELECT * FROM academic_years WHERE year_id = ? FOR UPDATE',
      [merged.year_id]);
    const year = yearRows[0];
    if (!year) throw missingRef('academic year');
    if (!merged.start_date || !merged.end_date) {
      throw rule('TERM_DATE_PAIR', 'Both term start and end dates are required');
    }
    if (merged.end_date < merged.start_date) {
      throw rule('TERM_DATES', 'Term end date cannot be before its start date');
    }
    const inside = (d?: string | null) => !d ||
      ((!year.start_date || d >= year.start_date) && (!year.end_date || d <= year.end_date));
    if (!inside(merged.start_date) || !inside(merged.end_date)) {
      throw rule('TERM_OUTSIDE_YEAR', `Term dates must lie within the academic year (${year.start_date} to ${year.end_date})`);
    }
    if (merged.status === 'ACTIVE') {
      if (!year.is_active) throw rule('YEAR_INACTIVE', 'An active term must belong to an active academic year');
      const [conflicts]: any = await conn.query(
        `SELECT term_id, term_name FROM terms
         WHERE year_id = ? AND status = 'ACTIVE' AND term_id <> ?
           AND (start_date IS NULL OR end_date IS NULL OR (start_date <= ? AND end_date >= ?))
         LIMIT 1`,
        [merged.year_id, existing?.term_id ?? 0, merged.end_date, merged.start_date]);
      if (conflicts.length) {
        throw new HttpError(409, `Active term "${conflicts[0].term_name}" overlaps these dates`, 'TERM_CONFLICT');
      }
    }
    if (existing && existing.parity !== merged.parity) {
      const [s]: any = await conn.query('SELECT 1 FROM sections WHERE term_id = ? LIMIT 1', [existing.term_id]);
      if (s.length) throw rule('PARITY_LOCKED', 'Term parity cannot change once sections exist in the term');
    }
  },
  noDelete: true,
});

// ---------- Programs, schemes, semesters ----------
add({
  path: 'programs', table: 'programs', pk: 'program_id', orderBy: 'dept_id, program_code',
  create: z.object({ dept_id: fk, program_code: text(30), program_name: text(150), is_active: bool.optional() }),
  immutable: ['dept_id'], filters: { dept_id: paramId, is_active: queryBool },
  hook: async ({ conn, merged, existing }) => {
    if (merged.is_active !== 0) {
      const dept = await need(conn, 'departments', 'dept_id', merged.dept_id, 'department');
      if (!dept.is_active) throw rule('DEPARTMENT_INACTIVE', 'An active program requires an active department');
    }
    if (existing && merged.is_active === 0) {
      const [mappings]: any = await conn.query(
        `SELECT tps.term_program_semester_id
         FROM term_program_semesters tps
         JOIN curriculum_schemes cs ON cs.scheme_id = tps.scheme_id
         WHERE cs.program_id = ? AND tps.is_active = 1
         UNION ALL
         SELECT s.section_id
         FROM sections s
         JOIN curriculum_schemes cs ON cs.scheme_id = s.scheme_id
         WHERE cs.program_id = ? AND s.is_active = 1
         LIMIT 1`,
        [existing.program_id, existing.program_id]);
      if (mappings.length) throw new HttpError(409, 'Archive dependent divisions and deactivate this program’s term-semester configurations first', 'IN_USE');
    }
  },
  noDelete: true,
});

add({
  path: 'schemes', table: 'curriculum_schemes', pk: 'scheme_id', orderBy: 'program_id, scheme_code, version',
  create: z.object({
    program_id: fk, scheme_code: text(30), version: text(20).optional(),
    effective_from: nullableDate, effective_to: nullableDate, is_active: bool.optional(),
  }),
  immutable: ['program_id'], filters: { program_id: paramId, is_active: queryBool },
  hook: async ({ conn, merged, existing }) => {
    if (merged.effective_from && merged.effective_to && merged.effective_to < merged.effective_from) {
      throw rule('SCHEME_DATES', 'effective_to cannot be before effective_from');
    }
    const programId = existing?.program_id ?? merged.program_id;
    const program = await need(conn, 'programs', 'program_id', programId, 'program');
    if (merged.is_active !== 0 && !program.is_active) {
      throw rule('PROGRAM_INACTIVE', 'An active curriculum scheme requires an active program');
    }
    if (existing && merged.is_active === 0) {
      const [mappings]: any = await conn.query(
        `SELECT term_program_semester_id FROM term_program_semesters WHERE scheme_id = ? AND is_active = 1
         UNION ALL
         SELECT section_id FROM sections WHERE scheme_id = ? AND is_active = 1
         LIMIT 1`,
        [existing.scheme_id, existing.scheme_id]);
      if (mappings.length) throw new HttpError(409, 'Archive dependent divisions and deactivate this scheme’s term-semester configurations first', 'IN_USE');
    }
  },
  noDelete: true,
});

add({
  path: 'semesters', table: 'semesters', pk: 'semester_id', orderBy: 'scheme_id, semester_no',
  create: z.object({ scheme_id: fk, semester_no: z.number().int().min(1).max(12), name: optText(40), is_active: bool.optional() }),
  immutable: ['scheme_id', 'semester_no'], filters: { scheme_id: paramId, is_active: queryBool },
  hook: async ({ conn, merged, existing }) => {
    const schemeId = existing?.scheme_id ?? merged.scheme_id;
    const scheme = await need(conn, 'curriculum_schemes', 'scheme_id', schemeId, 'curriculum scheme');
    const program = await need(conn, 'programs', 'program_id', scheme.program_id, 'program');
    if (merged.is_active !== 0 && (!scheme.is_active || !program.is_active)) {
      throw rule('INACTIVE_CURRICULUM', 'An active semester requires an active program and curriculum scheme');
    }
    if (existing && merged.is_active === 0) {
      const [mappings]: any = await conn.query(
        `SELECT term_program_semester_id FROM term_program_semesters WHERE semester_id = ? AND is_active = 1
         UNION ALL
         SELECT section_id FROM sections WHERE semester_id = ? AND is_active = 1
         LIMIT 1`,
        [existing.semester_id, existing.semester_id]);
      if (mappings.length) throw new HttpError(409, 'Archive dependent divisions and deactivate this semester’s term configurations first', 'IN_USE');
    }
  },
  noDelete: true,
});

add({
  path: 'term-program-semesters', table: 'term_program_semesters', pk: 'term_program_semester_id',
  orderBy: 'term_id, scheme_id, semester_id',
  create: z.object({ term_id: fk, semester_id: fk, is_active: bool.optional() }),
  immutable: ['term_id', 'semester_id'],
  filters: { term_id: paramId, scheme_id: paramId, semester_id: paramId, is_active: queryBool },
  noDelete: true,
  hook: async ({ conn, merged, existing }) => {
    const term = await need(conn, 'terms', 'term_id', merged.term_id, 'term');
    const semester = await need(conn, 'semesters', 'semester_id', merged.semester_id, 'semester');
    const scheme = await need(conn, 'curriculum_schemes', 'scheme_id', semester.scheme_id, 'curriculum scheme');
    const program = await need(conn, 'programs', 'program_id', scheme.program_id, 'program');
    if (merged.is_active !== 0 && !semesterMatchesParity(Number(semester.semester_no), term.parity)) {
      throw rule('TERM_SEMESTER_PARITY_MISMATCH', `Semester ${semester.semester_no} does not belong to the ${term.parity.toLowerCase()} term configuration`);
    }
    if ((!existing || merged.is_active !== 0) && term.status === 'CLOSED') {
      throw rule('TERM_CLOSED', 'Cannot configure active semesters for an archived term');
    }
    if (merged.is_active !== 0 && (!program.is_active || !scheme.is_active || !semester.is_active)) {
      throw rule('INACTIVE_CURRICULUM', 'An active term-semester configuration requires an active program, scheme and semester');
    }
    if (existing && merged.is_active === 0) {
      const [activeSections]: any = await conn.query(
        `SELECT section_id FROM sections
         WHERE term_id = ? AND scheme_id = ? AND semester_id = ? AND is_active = 1 LIMIT 1`,
        [merged.term_id, existing.scheme_id, merged.semester_id]);
      if (activeSections.length) {
        throw new HttpError(409, 'Deactivate or archive the divisions before deactivating this term-semester configuration', 'IN_USE');
      }
    }
    return { scheme_id: semester.scheme_id };
  },
});

const sectionHook: Hook = async ({ conn, merged, existing }) => {
  const sem = await need(conn, 'semesters', 'semester_id', merged.semester_id, 'semester');
  const term = await need(conn, 'terms', 'term_id', merged.term_id, 'term');
  if (!existing && term.status === 'CLOSED') throw rule('TERM_CLOSED', 'Cannot add sections to a closed term');
  const [configuration]: any = await conn.query(
    `SELECT tps.is_active, s.is_active AS semester_active, cs.is_active AS scheme_active,
            p.is_active AS program_active
     FROM term_program_semesters tps
     JOIN semesters s ON s.semester_id = tps.semester_id
     JOIN curriculum_schemes cs ON cs.scheme_id = tps.scheme_id
     JOIN programs p ON p.program_id = cs.program_id
     WHERE tps.term_id = ? AND tps.scheme_id = ? AND tps.semester_id = ?`,
    [merged.term_id, sem.scheme_id, sem.semester_id]);
  if (!configuration[0]) {
    throw rule('TERM_SEMESTER_NOT_CONFIGURED', 'Configure this program semester for the term before adding a division');
  }
  if (merged.is_active !== 0) {
    if (!configuration[0].is_active) {
      throw rule('TERM_SEMESTER_INACTIVE', 'Activate this term-semester configuration before activating its division');
    }
    if (!configuration[0].semester_active || !configuration[0].scheme_active || !configuration[0].program_active) {
      throw rule('INACTIVE_CURRICULUM', 'An active division requires an active program, scheme and semester');
    }
    if (term.status === 'CLOSED') throw rule('TERM_CLOSED', 'Cannot add or activate a division in an archived term');
  }
  if (merged.strength != null) {
    const [batchRows]: any = await conn.query(
      'SELECT COALESCE(SUM(strength), 0) AS total FROM batches WHERE section_id = ? AND is_active = 1',
      [existing?.section_id ?? 0]);
    if (Number(batchRows[0].total) > merged.strength) {
      throw rule('BATCH_EXCEEDS_SECTION', 'Active lab-batch strength exceeds the division strength');
    }
  }
  if (existing && merged.is_active === 0) {
    const [activeBatches]: any = await conn.query(
      'SELECT batch_id FROM batches WHERE section_id = ? AND is_active = 1 LIMIT 1',
      [existing.section_id]);
    if (activeBatches.length) {
      throw new HttpError(409, 'Deactivate the division batches before deactivating the division', 'IN_USE');
    }
  }
  return { scheme_id: sem.scheme_id }; // derived: never trusted from the client
};
add({
  path: 'sections', table: 'sections', pk: 'section_id', orderBy: 'term_id, semester_id, section_name',
  create: z.object({
    term_id: fk, semester_id: fk, section_name: text(20),
    strength: z.number().int().positive().nullable().optional(), is_active: bool.optional(), data_status: dataStatus.optional(),
  }),
  immutable: ['term_id', 'semester_id'], filters: { term_id: paramId, semester_id: paramId, scheme_id: paramId },
  hook: sectionHook,
  noDelete: true,
});

add({
  path: 'batches', table: 'batches', pk: 'batch_id', orderBy: 'section_id, batch_name',
  create: z.object({
    section_id: fk, batch_name: text(30), batch_type: z.enum(['LAB', 'TUTORIAL', 'ELECTIVE', 'OTHER']).optional(),
    strength: z.number().int().positive().nullable().optional(), is_active: bool.optional(),
  }),
  immutable: ['section_id'], filters: { section_id: paramId, is_active: queryBool },
  noDelete: true,
  hook: async ({ conn, merged, existing }) => {
    const sec = await need(conn, 'sections', 'section_id', merged.section_id, 'section');
    if (merged.is_active !== 0 && !sec.is_active) throw rule('SECTION_INACTIVE', 'An active batch must belong to an active division');
    const [terms]: any = await conn.query('SELECT status FROM terms WHERE term_id = ?', [sec.term_id]);
    if (merged.is_active !== 0 && terms[0]?.status === 'CLOSED') throw rule('TERM_CLOSED', 'Cannot activate a batch in an archived term');
    if (merged.strength != null && sec.strength != null && merged.strength > sec.strength) {
      throw rule('BATCH_EXCEEDS_SECTION', `Batch strength ${merged.strength} exceeds the division strength ${sec.strength}`);
    }
    if (merged.is_active !== 0 && merged.strength != null && sec.strength != null) {
      const [batchRows]: any = await conn.query(
        `SELECT COALESCE(SUM(strength), 0) AS total FROM batches
         WHERE section_id = ? AND is_active = 1 AND batch_id <> ?`,
        [merged.section_id, existing?.batch_id ?? 0]);
      if (Number(batchRows[0].total) + merged.strength > sec.strength) {
        throw rule('BATCH_EXCEEDS_SECTION', 'Active lab-batch strengths exceed the division strength');
      }
    }
  },
});

// ---------- Rooms ----------
add({
  path: 'room-types', table: 'room_types', pk: 'room_type_id', orderBy: 'type_code',
  create: z.object({ type_code: code(2, 30), type_name: text(80), description: optText(255), is_active: bool.optional() }),
});

add({
  path: 'rooms', table: 'rooms', pk: 'room_id', orderBy: 'room_code',
  create: z.object({
    room_code: text(30), room_name: optText(100), room_type_id: fk,
    capacity: z.number().int().positive().nullable().optional(), equipment: optText(255), location: optText(120),
    practical_approved: bool.optional(), data_status: dataStatus.optional(), is_active: bool.optional(),
  }),
  filters: { room_type_id: paramId, is_active: queryBool },
  hook: async ({ conn, data, existing, merged }) => {
    if (data.practical_approved !== undefined) {
      const [columns]: any = await conn.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'rooms' AND column_name = 'practical_approved'`,
      );
      if (!columns.length) {
        throw new HttpError(409, 'Apply migration 008 before configuring classroom practical approval', 'MIGRATION_REQUIRED');
      }
    }
    if (!existing || data.room_type_id !== undefined) {
      const roomType = await need(conn, 'room_types', 'room_type_id', merged.room_type_id, 'room type');
      if (!roomType.is_active) throw rule('ROOM_TYPE_INACTIVE', 'Select an active room type');
    }
    if (existing?.is_active && merged.is_active === 0) {
      const [usage]: any = await conn.query(
        `SELECT ss.session_id FROM scheduled_sessions ss
         JOIN timetable_versions tv ON tv.version_id = ss.version_id
         WHERE ss.room_id = ? AND tv.status IN ('DRAFT','VALIDATED','IN_REVIEW','APPROVED','PUBLISHED')
         LIMIT 1`,
        [existing.room_id],
      );
      if (usage.length) {
        throw new HttpError(409, 'This room is assigned in an active or published timetable. Remove the assignment before deactivating it.', 'ROOM_IN_USE');
      }
    }
  },
});

add({
  path: 'room-availability', table: 'room_availability', pk: 'room_availability_id', orderBy: 'room_id, day, start_time',
  create: z.object({
    room_id: fk, term_id: fk, day: dayName, start_time: timeStr, end_time: timeStr,
    availability_type: availabilityType, // explicit: there is no silent default
    data_status: dataStatus.optional(),
  }),
  immutable: ['room_id', 'term_id'], filters: { room_id: paramId, term_id: paramId, day: dayName },
  hook: async ({ conn, merged, existing }) => {
    if (!existing) {
      const room = await need(conn, 'rooms', 'room_id', merged.room_id, 'room');
      if (!room.is_active) throw rule('ROOM_INACTIVE', 'Room availability can only be created for an active room');
      await need(conn, 'terms', 'term_id', merged.term_id, 'term');
    }
    if (merged.end_time <= merged.start_time) throw rule('TIME_ORDER', 'end_time must be after start_time');
    const [clash]: any = await conn.query(
      `SELECT room_availability_id FROM room_availability WHERE room_id = ? AND term_id = ? AND \`day\` = ?
       AND room_availability_id <> ? AND start_time < ? AND end_time > ? LIMIT 1`,
      [merged.room_id, merged.term_id, merged.day, existing?.room_availability_id ?? 0, merged.end_time, merged.start_time]);
    if (clash.length) throw rule('AVAILABILITY_OVERLAP', 'Overlaps an existing availability window for this room and day');
  },
});

// ---------- Courses ----------
add({
  path: 'courses', table: 'courses', pk: 'course_id', orderBy: 'course_name',
  create: z.object({
    dept_id: fk.nullable().optional(), course_code: optText(30), course_name: text(200),
    credits: z.number().min(0).max(99.9).nullable().optional(), category: optText(20),
    is_active: bool.optional(), data_status: dataStatus.optional(),
  }),
  filters: { dept_id: paramId, is_active: queryBool, course_code: z.string().trim().min(1).max(30) },
});

add({
  path: 'components', table: 'course_components', pk: 'component_id', orderBy: 'course_id, component_type',
  create: z.object({
    course_id: fk, component_type: z.enum(['THEORY', 'TUTORIAL', 'LAB', 'PROJECT']),
    // Fractional hours are accepted (e.g. 1.5); whether a fractional session fits the grid is checked by the validator.
    weekly_hours: z.number().min(0).max(99.99).nullable().optional(),
    periods_per_session: z.number().int().min(1).max(12).nullable().optional(),
    is_consecutive: bool.optional(), required_room_type_id: fk.nullable().optional(), data_status: dataStatus.optional(),
  }),
  immutable: ['course_id', 'component_type'], filters: { course_id: paramId, component_type: z.enum(['THEORY', 'TUTORIAL', 'LAB', 'PROJECT']) },
  hook: async ({ merged }) => {
    if (merged.is_consecutive && !(merged.periods_per_session >= 2)) {
      throw rule('CONSECUTIVE_NEEDS_PERIODS', 'A consecutive component needs periods_per_session of at least 2');
    }
  },
});

add({
  path: 'curriculum-courses', table: 'curriculum_courses', pk: 'curriculum_course_id', orderBy: 'semester_id, course_id',
  create: z.object({ semester_id: fk, course_id: fk, is_elective: bool.optional(), group_id: fk.nullable().optional() }),
  immutable: ['semester_id', 'course_id'], filters: { semester_id: paramId, scheme_id: paramId, course_id: paramId },
  hook: async ({ conn, merged }) => {
    const sem = await need(conn, 'semesters', 'semester_id', merged.semester_id, 'semester');
    const course = await need(conn, 'courses', 'course_id', merged.course_id, 'course');
    if (course.course_code) {
      const [duplicates]: any = await conn.query(
        `SELECT cc.curriculum_course_id
         FROM curriculum_courses cc
         JOIN courses existing_course ON existing_course.course_id = cc.course_id
         WHERE cc.semester_id = ? AND cc.course_id <> ?
           AND LOWER(TRIM(existing_course.course_code)) = LOWER(TRIM(?))
         LIMIT 1`,
        [merged.semester_id, merged.course_id, course.course_code]);
      if (duplicates.length) {
        throw new HttpError(409, `Subject code "${course.course_code}" already exists in this semester`, 'DUPLICATE_SUBJECT_CODE');
      }
    }
    if (merged.group_id) {
      if (!merged.is_elective) throw rule('GROUP_NEEDS_ELECTIVE', 'Only elective courses can belong to an elective group');
      await need(conn, 'elective_groups', 'elective_group_id', merged.group_id, 'elective group');
    }
    return { scheme_id: sem.scheme_id };
  },
});

// ---------- Offerings, audiences, electives ----------
add({
  path: 'offerings', table: 'course_offerings', pk: 'offering_id', orderBy: 'term_id, component_id',
  create: z.object({
    component_id: fk, term_id: fk, offering_code: optText(40), pattern_type: z.enum(['WEEKLY', 'IRREGULAR', 'CUSTOM']).optional(),
    status: z.enum(['DRAFT', 'OFFERED', 'CANCELLED']).optional(), data_status: dataStatus.optional(),
  }),
  immutable: ['component_id', 'term_id'],
  filters: { term_id: paramId, component_id: paramId, status: z.enum(['DRAFT', 'OFFERED', 'CANCELLED']) },
  hook: async ({ conn, merged, existing }) => {
    await need(conn, 'course_components', 'component_id', merged.component_id, 'course component');
    const term = await need(conn, 'terms', 'term_id', merged.term_id, 'term');
    if (!existing && term.status === 'CLOSED') throw rule('TERM_CLOSED', 'Cannot add offerings to a closed term');
  },
});

add({
  path: 'audiences', table: 'offering_audiences', pk: 'audience_id', orderBy: 'offering_id, section_id, batch_id',
  create: z.object({ offering_id: fk, section_id: fk, batch_id: fk.nullable().optional(), strength: nullableInt, data_status: dataStatus.optional() }),
  immutable: ['offering_id', 'section_id', 'batch_id'], filters: { offering_id: paramId, section_id: paramId, term_id: paramId },
  hook: async ({ conn, merged, existing }) => {
    if (existing) return;
    const off = await need(conn, 'course_offerings', 'offering_id', merged.offering_id, 'offering');
    const sec = await need(conn, 'sections', 'section_id', merged.section_id, 'section');
    if (off.status === 'CANCELLED') throw rule('OFFERING_CANCELLED', 'Cannot attach an audience to a cancelled offering');
    if (sec.term_id !== off.term_id) throw rule('SECTION_TERM_MISMATCH', 'The section and the offering belong to different terms');
    if (merged.batch_id) {
      const b = await need(conn, 'batches', 'batch_id', merged.batch_id, 'batch');
      if (b.section_id !== merged.section_id) throw rule('BATCH_SECTION_MISMATCH', 'The batch does not belong to the given section');
    }
    return { term_id: off.term_id };
  },
});

add({
  path: 'elective-groups', table: 'elective_groups', pk: 'elective_group_id', orderBy: 'term_id, group_name',
  create: z.object({
    term_id: fk, group_name: text(80),
    // Baskets/combined sessions stay OFF unless an academic requirement justifies them.
    requires_parallel_slots: bool.optional(), allow_combined_faculty: bool.optional(), is_active: bool.optional(),
  }),
  immutable: ['term_id'], filters: { term_id: paramId, is_active: queryBool },
});

add({
  path: 'elective-group-offerings', table: 'elective_group_offerings', pk: 'group_offering_id', orderBy: 'elective_group_id, offering_id',
  create: z.object({ elective_group_id: fk, offering_id: fk }), noUpdate: true,
  filters: { elective_group_id: paramId, offering_id: paramId },
  hook: async ({ conn, merged }) => {
    const g = await need(conn, 'elective_groups', 'elective_group_id', merged.elective_group_id, 'elective group');
    const o = await need(conn, 'course_offerings', 'offering_id', merged.offering_id, 'offering');
    if (g.term_id !== o.term_id) throw rule('GROUP_TERM_MISMATCH', 'The elective group and the offering belong to different terms');
    return { term_id: g.term_id };
  },
});

// ---------- Teaching days and time slots ----------
add({
  path: 'teaching-days', table: 'term_teaching_days', pk: 'term_day_id', orderBy: 'term_id, day_name',
  create: z.object({ term_id: fk, day_name: dayName, is_teaching_day: bool.optional(), closing_time: timeStr.nullable().optional() }),
  immutable: ['term_id', 'day_name'], filters: { term_id: paramId },
  hook: async ({ conn, merged, existing }) => {
    await need(conn, 'terms', 'term_id', merged.term_id, 'term');
    const teaching = merged.is_teaching_day ?? 1;
    if (merged.day_name === 'SAT' && teaching) {
      if (!merged.closing_time) throw rule('SATURDAY_CLOSING_REQUIRED', `Saturday needs a closing time of ${SATURDAY_LATEST_END} or earlier`);
      if (merged.closing_time > SATURDAY_LATEST_END) {
        throw rule('SATURDAY_AFTER_CUTOFF', `Saturday teaching must end by ${SATURDAY_LATEST_END}`);
      }
    }
    if (existing && merged.closing_time) {
      const [late]: any = await conn.query(
        `SELECT s.slot_no FROM term_day_slots m JOIN time_slots s ON s.slot_id = m.slot_id
         WHERE m.term_day_id = ? AND m.is_active = 1 AND s.slot_type = 'TEACHING' AND s.end_time > ? LIMIT 1`,
        [existing.term_day_id, merged.closing_time]);
      if (late.length) throw rule('CLOSING_BEFORE_SLOT_END', `Slot ${late[0].slot_no} is active on this day and ends after the new closing time`);
    }
  },
});

add({
  path: 'time-slots', table: 'time_slots', pk: 'slot_id', orderBy: 'term_id, slot_no',
  create: z.object({
    term_id: fk, slot_no: z.number().int().min(1).max(50), start_time: timeStr, end_time: timeStr,
    slot_type: z.enum(['TEACHING', 'BREAK', 'LUNCH']).optional(), data_status: dataStatus.optional(),
  }),
  immutable: ['term_id'], filters: { term_id: paramId },
  hook: async ({ conn, merged, existing }) => {
    await need(conn, 'terms', 'term_id', merged.term_id, 'term');
    if (merged.end_time <= merged.start_time) throw rule('TIME_ORDER', 'end_time must be after start_time');
    if (existing) { // changed times/type must still fit every day this slot is active on
      const [days]: any = await conn.query('SELECT term_day_id FROM term_day_slots WHERE slot_id = ? AND is_active = 1', [existing.slot_id]);
      for (const d of days) await checkDayGrid(conn, d.term_day_id, { ...merged, slot_type: merged.slot_type ?? 'TEACHING' }, existing.slot_id);
    }
  },
});

add({
  path: 'term-day-slots', table: 'term_day_slots', pk: 'term_day_slot_id', orderBy: 'term_day_id, slot_id',
  create: z.object({ term_day_id: fk, slot_id: fk, is_active: bool.optional() }),
  immutable: ['term_day_id', 'slot_id'], filters: { term_id: paramId, term_day_id: paramId, slot_id: paramId },
  hook: async ({ conn, merged }) => {
    const day = await need(conn, 'term_teaching_days', 'term_day_id', merged.term_day_id, 'teaching day');
    const slot = await need(conn, 'time_slots', 'slot_id', merged.slot_id, 'time slot');
    if (slot.term_id !== day.term_id) throw rule('SLOT_TERM_MISMATCH', 'The time slot and the teaching day belong to different terms');
    if (merged.is_active ?? 1) await checkDayGrid(conn, day.term_day_id, slot, slot.slot_id);
    return { term_id: day.term_id };
  },
});

// ---------- Router ----------
export const masterdataRouter = Router();
masterdataRouter.use(authenticate);

masterdataRouter.get('/meta', requirePermission('masterdata:read'), (_req, res) => {
  res.json(ok({
    saturdayLatestEnd: SATURDAY_LATEST_END,
    dataStatuses: DATA_STATUSES,
    resources: resources.map((r) => r.path),
  }));
});

masterdataRouter.post('/term-program-semesters/map-parity', requirePermission('masterdata:write'), async (req, res, next) => {
  try {
    const body = z.object({ term_id: fk, program_id: fk }).strict().parse(req.body);
    const result = await withTransaction(async conn => {
      const [[term]]: any = await conn.query(
        'SELECT term_id, parity, status FROM terms WHERE term_id = ? FOR UPDATE',
        [body.term_id],
      );
      if (!term) throw missingRef('term');
      if (term.status === 'CLOSED') throw rule('TERM_CLOSED', 'Cannot configure semester mappings for an archived term');
      const program = await need(conn, 'programs', 'program_id', body.program_id, 'program');
      if (!program.is_active) throw rule('PROGRAM_INACTIVE', 'Semester mappings can only be created for an active program');

      const semesterNumbers = semestersForParity(term.parity);
      const [targets]: any = await conn.query(
        `SELECT s.semester_id, s.semester_no
         FROM programs p
         JOIN curriculum_schemes cs ON cs.program_id = p.program_id AND cs.is_active = 1
         JOIN semesters s ON s.scheme_id = cs.scheme_id AND s.is_active = 1
         WHERE p.program_id = ? AND p.is_active = 1 AND s.semester_no IN (?)
         ORDER BY cs.scheme_id, s.semester_no`,
        [body.program_id, semesterNumbers],
      );
      if (!targets.length) {
        return { created_count: 0, active_semesters: [], inactive_semesters: [], eligible_count: 0 };
      }

      let createdCount = 0;
      for (const target of targets) {
        const [insert]: any = await conn.query(
          `INSERT IGNORE INTO term_program_semesters (term_id, scheme_id, semester_id, is_active)
           SELECT ?, s.scheme_id, s.semester_id, 1
           FROM semesters s
           WHERE s.semester_id = ? AND s.is_active = 1`,
          [body.term_id, target.semester_id],
        );
        if (insert.affectedRows) {
          createdCount += 1;
          await audit(conn, req.user!.userId, 'MASTERDATA_CREATED', 'term_program_semesters', insert.insertId, {
            term_id: body.term_id,
            program_id: body.program_id,
            semester_id: target.semester_id,
            parity: term.parity,
            parity_mapping: true,
          });
        }
      }

      const [mappings]: any = await conn.query(
        `SELECT s.semester_no, tps.is_active
         FROM term_program_semesters tps
         JOIN semesters s ON s.semester_id = tps.semester_id AND s.scheme_id = tps.scheme_id
         JOIN curriculum_schemes cs ON cs.scheme_id = s.scheme_id
         WHERE tps.term_id = ? AND cs.program_id = ? AND s.semester_no IN (?)
         ORDER BY s.semester_no`,
        [body.term_id, body.program_id, semesterNumbers],
      );
      return {
        created_count: createdCount,
        eligible_count: targets.length,
        active_semesters: mappings.filter((mapping: any) => mapping.is_active).map((mapping: any) => Number(mapping.semester_no)),
        inactive_semesters: mappings.filter((mapping: any) => !mapping.is_active).map((mapping: any) => Number(mapping.semester_no)),
      };
    });
    res.status(201).json(ok(result));
  } catch (error) { next(error); }
});

const curriculumDraftContextQuerySchema = z.object({
  year_id: paramId,
  term_id: paramId,
  program_id: paramId,
  scheme_id: paramId,
  semester_id: paramId,
}).strict();

masterdataRouter.get('/curriculum-builder/draft', requirePermission('masterdata:read'), async (req, res, next) => {
  try {
    const context = curriculumDraftContextQuerySchema.parse(req.query);
    const result = await withTransaction(async conn => {
      await validateBuilderContext(conn, context);
      const [tables]: any = await conn.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = 'curriculum_drafts'`,
      );
      if (!tables.length) return { available: false, draft: null };

      const [[row]]: any = await conn.query(
        `SELECT draft_id, year_id, term_id, program_id, scheme_id, semester_id,
                draft_payload, version, created_at, updated_at
         FROM curriculum_drafts
         WHERE year_id = ? AND term_id = ? AND program_id = ? AND scheme_id = ? AND semester_id = ?`,
        [context.year_id, context.term_id, context.program_id, context.scheme_id, context.semester_id],
      );
      return { available: true, draft: row ? mapCurriculumDraft(row) : null };
    });
    res.json(ok(result));
  } catch (error) { next(error); }
});

masterdataRouter.post('/curriculum-builder/drafts', requirePermission('masterdata:write'), async (req, res, next) => {
  try {
    const input = curriculumDraftInputSchema.parse(req.body);
    const context: CurriculumDraftContext = {
      year_id: input.year_id,
      term_id: input.term_id,
      program_id: input.program_id,
      scheme_id: input.scheme_id,
      semester_id: input.semester_id,
    };
    const created = await withTransaction(async conn => {
      await requireCurriculumDraftTable(conn);
      await validateBuilderContext(conn, context);
      await validateDraftRoomTypes(conn, input.subjects);
      await validateDraftAudienceSections(conn, context, input.subjects);
      const [insert]: any = await conn.query(
        `INSERT INTO curriculum_drafts
          (year_id, term_id, program_id, scheme_id, semester_id, draft_payload, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          context.year_id, context.term_id, context.program_id, context.scheme_id, context.semester_id,
          serializeCurriculumDraftSubjects(input.subjects), req.user!.userId, req.user!.userId,
        ],
      );
      await audit(conn, req.user!.userId, 'CURRICULUM_DRAFT_CREATED', 'curriculum_drafts', insert.insertId, context);
      const [[row]]: any = await conn.query('SELECT * FROM curriculum_drafts WHERE draft_id = ?', [insert.insertId]);
      return mapCurriculumDraft(row);
    });
    res.status(201).json(ok(created));
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return next(new HttpError(409, 'A curriculum draft already exists for this context. Restore it before saving changes.', 'CURRICULUM_DRAFT_EXISTS'));
    }
    next(error);
  }
});

masterdataRouter.put('/curriculum-builder/drafts/:draftId', requirePermission('masterdata:write'), async (req, res, next) => {
  try {
    const draftId = paramId.parse(req.params.draftId);
    const input = curriculumDraftUpdateSchema.parse(req.body);
    const context: CurriculumDraftContext = {
      year_id: input.year_id,
      term_id: input.term_id,
      program_id: input.program_id,
      scheme_id: input.scheme_id,
      semester_id: input.semester_id,
    };
    const updated = await withTransaction(async conn => {
      await requireCurriculumDraftTable(conn);
      const [[existing]]: any = await conn.query(
        'SELECT * FROM curriculum_drafts WHERE draft_id = ? FOR UPDATE',
        [draftId],
      );
      if (!existing) throw new HttpError(404, 'Curriculum draft not found', 'NOT_FOUND');
      assertCurriculumDraftContextMatches(existing, context);
      assertCurriculumDraftVersion(input.expected_version, Number(existing.version));
      await validateBuilderContext(conn, context);
      await validateDraftRoomTypes(conn, input.subjects);
      await validateDraftAudienceSections(conn, context, input.subjects);

      const [result]: any = await conn.query(
        `UPDATE curriculum_drafts
         SET draft_payload = ?, version = version + 1, updated_by = ?
         WHERE draft_id = ? AND version = ?`,
        [serializeCurriculumDraftSubjects(input.subjects), req.user!.userId, draftId, input.expected_version],
      );
      if (result.affectedRows !== 1) {
        throw new HttpError(409, 'This curriculum draft changed during the update. Restore the latest version before saving.', 'CURRICULUM_DRAFT_VERSION_CONFLICT');
      }
      await audit(conn, req.user!.userId, 'CURRICULUM_DRAFT_UPDATED', 'curriculum_drafts', draftId, {
        ...context,
        version: input.expected_version + 1,
      });
      const [[row]]: any = await conn.query('SELECT * FROM curriculum_drafts WHERE draft_id = ?', [draftId]);
      return mapCurriculumDraft(row);
    });
    res.json(ok(updated));
  } catch (error) { next(error); }
});

const curriculumDraftDeleteQuerySchema = curriculumDraftContextQuerySchema.extend({
  expected_version: paramId,
}).strict();

masterdataRouter.delete('/curriculum-builder/drafts/:draftId', requirePermission('masterdata:write'), async (req, res, next) => {
  try {
    const draftId = paramId.parse(req.params.draftId);
    const query = curriculumDraftDeleteQuerySchema.parse(req.query);
    const context: CurriculumDraftContext = {
      year_id: query.year_id,
      term_id: query.term_id,
      program_id: query.program_id,
      scheme_id: query.scheme_id,
      semester_id: query.semester_id,
    };
    await withTransaction(async conn => {
      await requireCurriculumDraftTable(conn);
      const [[existing]]: any = await conn.query(
        'SELECT * FROM curriculum_drafts WHERE draft_id = ? FOR UPDATE',
        [draftId],
      );
      if (!existing) throw new HttpError(404, 'Curriculum draft not found', 'NOT_FOUND');
      assertCurriculumDraftContextMatches(existing, context);
      assertCurriculumDraftVersion(query.expected_version, Number(existing.version));
      const [result]: any = await conn.query(
        'DELETE FROM curriculum_drafts WHERE draft_id = ? AND version = ?',
        [draftId, query.expected_version],
      );
      if (result.affectedRows !== 1) {
        throw new HttpError(409, 'This curriculum draft changed during deletion. Reload it and try again.', 'CURRICULUM_DRAFT_VERSION_CONFLICT');
      }
      await audit(conn, req.user!.userId, 'CURRICULUM_DRAFT_DELETED', 'curriculum_drafts', draftId, context);
    });
    res.json(ok({ draft_id: draftId, deleted: true }));
  } catch (error) { next(error); }
});

masterdataRouter.get('/curriculum-builder/term-semesters', requirePermission('masterdata:read'), async (req, res, next) => {
  try {
    const termId = paramId.parse(req.query.term_id);
    const [tables]: any = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'term_program_semesters'`);
    if (!tables.length) {
      res.json(ok({ mappingAvailable: false, rows: [] }));
      return;
    }
    const [rows]: any = await pool.query(
      `SELECT term_id, scheme_id, semester_id, is_active
       FROM term_program_semesters WHERE term_id = ? ORDER BY scheme_id, semester_id`,
      [termId]);
    res.json(ok({ mappingAvailable: true, rows }));
  } catch (error) { next(error); }
});

masterdataRouter.post('/curriculum-builder/validate', requirePermission('masterdata:write'), async (req, res, next) => {
  try {
    const payload = validateCurriculumBuilderPayload(req.body);
    const result = await withTransaction(async (conn) => {
      const context = await validateBuilderContext(conn, payload);
      await validateBuilderSubjects(conn, payload);
      return context;
    });
    res.json(ok({
      valid: true,
      subject_count: payload.subjects.length,
      component_count: payload.subjects.reduce((sum, subject) => sum + subject.components.length, 0),
      mapping_available: result.mappingAvailable,
    }));
  } catch (error) { next(error); }
});

masterdataRouter.post('/curriculum-builder/publish', requirePermission('masterdata:write'), async (req, res, next) => {
  try {
    const publishInput = z.object({
      draft_id: fk.optional(),
      draft_version: fk.optional(),
    }).passthrough().parse(req.body);
    if ((publishInput.draft_id === undefined) !== (publishInput.draft_version === undefined)) {
      throw new HttpError(400, 'Both draft_id and draft_version are required to publish a saved draft', 'CURRICULUM_DRAFT_VERSION_REQUIRED');
    }
    const { draft_id: draftId, draft_version: draftVersion, ...payloadInput } = publishInput;
    const payload = validateCurriculumBuilderPayload(payloadInput);
    const result = await withTransaction(async (conn) => {
      if (draftId !== undefined && draftVersion !== undefined) {
        await requireCurriculumDraftTable(conn);
        const [[savedDraft]]: any = await conn.query(
          'SELECT * FROM curriculum_drafts WHERE draft_id = ? FOR UPDATE',
          [draftId],
        );
        if (!savedDraft) {
          throw new HttpError(409, 'The saved curriculum draft no longer exists. Restore or save the draft again.', 'CURRICULUM_DRAFT_NOT_FOUND');
        }
        assertCurriculumDraftContextMatches(savedDraft, payload);
        assertCurriculumDraftVersion(draftVersion, Number(savedDraft.version));
      }
      const context = await validateBuilderContext(conn, payload);
      await validateBuilderSubjects(conn, payload);
      const saved: Array<{ course_id: number; curriculum_course_id: number; component_ids: number[]; offering_ids: number[]; audience_ids: number[] }> = [];
      for (const subject of payload.subjects) {
        const [courseInsert]: any = await conn.query(
          'INSERT INTO courses SET ?',
          [{
            dept_id: context.deptId,
            course_code: subject.course_code,
            course_name: subject.course_name,
            category: subject.category || null,
            credits: subject.credits ?? null,
            is_active: 1,
            data_status: 'VERIFY',
          }]);
        const componentIds: number[] = [];
        const offeringIds: number[] = [];
        const audienceIds: number[] = [];
        for (const component of subject.components) {
          const [componentInsert]: any = await conn.query(
            'INSERT INTO course_components SET ?',
            [{
              course_id: courseInsert.insertId,
              component_type: component.component_type,
              weekly_hours: component.weekly_hours,
              periods_per_session: component.periods_per_session ?? null,
              is_consecutive: component.is_consecutive ? 1 : 0,
              required_room_type_id: component.required_room_type_id ?? null,
              data_status: 'VERIFY',
            }]);
          componentIds.push(componentInsert.insertId);
          await audit(conn, req.user?.userId ?? null, 'MASTERDATA_CREATED', 'course_components', componentInsert.insertId, {
            resource: 'components', curriculum_builder: true,
          });
          const [offeringInsert]: any = await conn.query(
            'INSERT INTO course_offerings SET ?',
            [{
              component_id: componentInsert.insertId,
              term_id: payload.term_id,
              status: 'OFFERED',
              data_status: 'VERIFY',
            }]);
          offeringIds.push(offeringInsert.insertId);
          await audit(conn, req.user?.userId ?? null, 'MASTERDATA_CREATED', 'course_offerings', offeringInsert.insertId, {
            resource: 'offerings', curriculum_builder: true,
          });
          for (const sectionId of subject.audience_section_ids) {
            const [audienceInsert]: any = await conn.query(
              `INSERT INTO offering_audiences
                (offering_id, term_id, section_id, strength, data_status)
               SELECT ?, sec.term_id, sec.section_id, sec.strength, 'VERIFY'
               FROM sections sec
               WHERE sec.section_id = ? AND sec.term_id = ? AND sec.scheme_id = ?
                 AND sec.semester_id = ? AND sec.is_active = 1`,
              [offeringInsert.insertId, sectionId, payload.term_id, payload.scheme_id, payload.semester_id],
            );
            if (audienceInsert.affectedRows !== 1) {
              throw new HttpError(409, 'A selected division changed or became inactive during publishing. No curriculum changes were saved.', 'OFFERING_AUDIENCE_CONTEXT_MISMATCH');
            }
            audienceIds.push(audienceInsert.insertId);
            await audit(conn, req.user!.userId, 'MASTERDATA_CREATED', 'offering_audiences', audienceInsert.insertId, {
              offering_id: offeringInsert.insertId,
              section_id: sectionId,
              curriculum_builder: true,
            });
          }
        }
        const [mappingInsert]: any = await conn.query(
          'INSERT INTO curriculum_courses SET ?',
          [{
            scheme_id: payload.scheme_id,
            semester_id: payload.semester_id,
            course_id: courseInsert.insertId,
            is_elective: subject.is_elective ? 1 : 0,
          }]);
        await audit(conn, req.user?.userId ?? null, 'MASTERDATA_CREATED', 'courses', courseInsert.insertId, {
          resource: 'courses', curriculum_builder: true,
        });
        await audit(conn, req.user?.userId ?? null, 'MASTERDATA_CREATED', 'curriculum_courses', mappingInsert.insertId, {
          resource: 'curriculum-courses', curriculum_builder: true,
        });
        saved.push({
          course_id: courseInsert.insertId,
          curriculum_course_id: mappingInsert.insertId,
          component_ids: componentIds,
          offering_ids: offeringIds,
          audience_ids: audienceIds,
        });
      }
      if (draftId !== undefined && draftVersion !== undefined) {
        const [deleted]: any = await conn.query(
          'DELETE FROM curriculum_drafts WHERE draft_id = ? AND version = ?',
          [draftId, draftVersion],
        );
        if (deleted.affectedRows !== 1) {
          throw new HttpError(409, 'The saved curriculum draft changed before publish completed. Restore the latest version and retry.', 'CURRICULUM_DRAFT_VERSION_CONFLICT');
        }
        await audit(conn, req.user!.userId, 'CURRICULUM_DRAFT_PUBLISHED', 'curriculum_drafts', draftId, {
          version: draftVersion,
          subject_count: saved.length,
        });
      }
      return { saved, mappingAvailable: context.mappingAvailable };
    });
    res.status(201).json(ok({
      subjects: result.saved,
      mapping_available: result.mappingAvailable,
      message: 'Validated curriculum was published successfully. Its term offerings are linked to the selected divisions and remain marked for verification.',
    }));
  } catch (error) { next(error); }
});

for (const cfg of resources) masterdataRouter.use(`/${cfg.path}`, crudRouter(cfg));
