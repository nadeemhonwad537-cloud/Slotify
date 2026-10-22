import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { env } from '../config/env';
import { ImportMasterData, WorkloadImportPreview } from '../services/workloadImportPreview';
import {
  CSE_WORKLOAD_SOURCE_KEY,
  digestWorkloadSource,
  matchesPersistedSource,
  WorkloadSourceArtifacts,
} from '../services/workloadImportService';

const projectRoot = path.resolve(__dirname, '../../../');
const docsRoot = path.join(projectRoot, 'docs/imports');
const sourceRoot = path.join(docsRoot, 'source');
const extractionPath = path.join(docsRoot, 'CSE_EVEN_2026_extraction.md');
const previewPath = path.join(docsRoot, 'CSE_EVEN_2026_preview.json');
const planPath = path.join(docsRoot, 'CSE_EVEN_2026_import_plan.md');
const planJsonPath = path.join(docsRoot, 'CSE_EVEN_2026_import_plan.json');
const page1Relative = 'docs/imports/source/CSE_EVEN_2026_page1.png';
const page2Relative = 'docs/imports/source/CSE_EVEN_2026_page2.jpe';

interface PlannedTableCount { insert: number; update: number; skip: number }
interface WorkloadImportPlan {
  generatedAt: string;
  targetDatabase: string;
  sourceKey: string;
  contentSha256: string;
  sourceHashes: { page1Sha256: string; page2Sha256: string };
  counts: Record<string, PlannedTableCount>;
  rows: Array<{
    sourceRow: number;
    page: number;
    sourceName: string | null;
    category: string;
    rawSubjectsAndHours: string;
    labDuty: string;
    otherWorkload: string;
    printedTheoryLabTotal: string;
    possibleCourseMatches: string;
    unresolved: string;
    destination: string;
    action: 'STAGE_FOR_REVIEW';
  }>;
  masterDataCandidates: {
    departments: ImportMasterData['departments'];
    faculty: ImportMasterData['faculty'];
    courses: Array<Pick<ImportMasterData['courses'][number], 'course_id' | 'course_code' | 'course_name' | 'dept_id'>>;
    terms: ImportMasterData['terms'];
    semesterCount: number;
    sectionCount: number;
    batchCount: number;
    assignmentCount: number;
  };
  expectedBlockerIssues: number;
  executionPolicy: string[];
}

function plannedCount(insert: number, skip = 0): PlannedTableCount {
  return { insert, update: 0, skip };
}

function renderPlan(plan: WorkloadImportPlan): string {
  const countRows = Object.entries(plan.counts)
    .map(([table, count]) => `| \`${table}\` | ${count.insert} | ${count.update} | ${count.skip} |`)
    .join('\n');
  const rows = plan.rows.map(row =>
    `| ${row.sourceRow} | ${row.page} | ${row.category} | ${row.sourceName ?? 'Missing source row'} | ${row.rawSubjectsAndHours} | ${row.labDuty} | ${row.otherWorkload} | ${row.printedTheoryLabTotal} | ${row.possibleCourseMatches} | ${row.unresolved} | \`${row.destination}\` |`,
  ).join('\n');
  const candidates = plan.masterDataCandidates;
  return [
    '# Final import plan — CSE workload, Even Semester 2026',
    '',
    `Generated: ${plan.generatedAt}`,
    '',
    `**Target:** \`${plan.targetDatabase}\`  `,
    `**Source key:** \`${plan.sourceKey}\`  `,
    `**Source content SHA-256:** \`${plan.contentSha256}\``,
    '',
    '## Planned record counts',
    '',
    '| Table | Insert | Update | Skip |',
    '|---|---:|---:|---:|',
    countRows,
    '',
    `Planned inserts: **${Object.values(plan.counts).reduce((sum, value) => sum + value.insert, 0)}**; updates: **0**; skipped: **${Object.values(plan.counts).reduce((sum, value) => sum + value.skip, 0)}**. This operation does not change existing institutional master data.`,
    '',
    '## Existing candidate records (no automatic linking)',
    '',
    `- Departments: ${candidates.departments.map(item => `${item.dept_id} / ${item.dept_code} / ${item.dept_name}`).join('; ') || 'none'}`,
    `- Faculty: ${candidates.faculty.map(item => `${item.faculty_id} / ${item.name} / ${item.staff_code ?? 'no staff code'}`).join('; ') || 'none'}`,
    `- Courses: ${candidates.courses.map(item => `${item.course_id} / ${item.course_code ?? '(no code)'} / ${item.course_name}`).join('; ') || 'none'}`,
    `- Term candidates: ${candidates.terms.map(item => `${item.term_id} / ${item.term_name} / ${item.year_label} / ${item.parity}`).join('; ') || 'none'}`,
    `- Semesters: ${candidates.semesterCount}; sections: ${candidates.sectionCount}; batches: ${candidates.batchCount}; assignments: ${candidates.assignmentCount}.`,
    '',
    '## Record-level mapping plan',
    '',
    'Every serial position is stored as a source-review row. The row key is `(source_key, source_row_number)`; source values are retained verbatim and separately from administrator resolution fields. No faculty/course/term/semester/section/batch mapping is assumed. Candidate course matches below are suggestions only.',
    '',
    '| Row | Page | Category | Source faculty | Subject labels / hours | Lab duty | SDP / minor project | Printed theory / lab / total | Possible course matches | Unresolved fields | Destination | Action |',
    '|---:|---:|---|---|---|---|---|---|---|---|---|---|',
    ...rows.split('\n').map(line => `${line} STAGE_FOR_REVIEW |`),
    '',
    '## Safeguards',
    '',
    ...plan.executionPolicy.map(item => `- ${item}`),
    '',
    'The machine-readable plan is `CSE_EVEN_2026_import_plan.json`. The import runner verifies this plan hash and planned counts inside a transaction and rolls back on any mismatch.',
    '',
  ].join('\n');
}

function subjectSummary(row: WorkloadImportPreview['rows'][number]): string {
  return row.subjects
    .filter(subject => subject.rawLabel || subject.weeklyHours !== null)
    .map(subject => `${subject.rawLabel ?? 'Unlabeled'} / ${subject.weeklyHours ?? 'unreadable'}h`)
    .join('; ') || '—';
}

function courseMatches(row: WorkloadImportPreview['rows'][number]): string {
  return row.subjectMatches
    .flatMap(subject => subject.candidates.map(candidate =>
      `${subject.rawLabel} -> ${candidate.course_code ?? '(no code)'} ${candidate.course_name} (${candidate.match}; unconfirmed)`,
    ))
    .join('; ') || 'none';
}

async function buildPlan() {
  if (env.DB_NAME !== 'slotify_dev') {
    throw new Error(`Refusing to plan against DB_NAME=${env.DB_NAME}; expected slotify_dev.`);
  }
  const markdown = fs.readFileSync(extractionPath, 'utf8');
  const preview = JSON.parse(fs.readFileSync(previewPath, 'utf8')) as WorkloadImportPreview;
  const artifacts: WorkloadSourceArtifacts = {
    markdown,
    page1Path: path.join(sourceRoot, 'CSE_EVEN_2026_page1.png'),
    page2Path: path.join(sourceRoot, 'CSE_EVEN_2026_page2.jpe'),
  };
  const digest = digestWorkloadSource(artifacts);
  if (preview.rows.length !== 39 || preview.writesPerformed !== false) {
    throw new Error('Preview is incomplete or does not carry the preview-only guarantee. Regenerate it first.');
  }

  const conn = await mysql.createConnection({
    host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD,
    database: 'slotify_dev', multipleStatements: false,
  });
  let transactionOpen = false;
  try {
    await conn.query('START TRANSACTION READ ONLY');
    transactionOpen = true;
    const [batches] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT batch_id, content_sha256, source_document_id FROM workload_import_batches WHERE source_key = ?',
      [CSE_WORKLOAD_SOURCE_KEY],
    );
    let batchExists = false;
    let rowSkip = 0;
    let provenanceSkip = 0;
    let discrepancySkip = 0;
    if (batches[0]) {
      if (batches[0].content_sha256 !== digest.contentSha256 &&
          !await matchesPersistedSource(conn, batches[0].source_document_id, preview, digest)) {
        throw new Error('Existing workload batch has a different source hash; refusing to prepare an overwrite.');
      }
      batchExists = true;
      const [rowCounts] = await conn.query<mysql.RowDataPacket[]>(
        'SELECT COUNT(*) AS n FROM workload_import_rows WHERE batch_id = ?', [batches[0].batch_id],
      );
      const [provCounts] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM data_provenance WHERE table_name = 'workload_import_rows'
         AND record_id IN (SELECT workload_import_row_id FROM workload_import_rows WHERE batch_id = ?)`,
        [batches[0].batch_id],
      );
      const [discCounts] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM discrepancy_log WHERE document_id = ?
         AND table_name = 'workload_import_rows'`, [batches[0].source_document_id],
      );
      rowSkip = Number(rowCounts[0].n);
      provenanceSkip = Number(provCounts[0].n);
      discrepancySkip = Number(discCounts[0].n);
      if (rowSkip !== 39 || provenanceSkip !== 39 || discrepancySkip !== preview.rows.flatMap(row => row.issues.filter(issue => issue.severity === 'BLOCKER')).length) {
        throw new Error('An existing batch is incomplete; the plan will not silently repair or overwrite it.');
      }
    }
    const blockerCount = preview.rows.flatMap(row => row.issues.filter(issue => issue.severity === 'BLOCKER')).length;
    const counts: Record<string, PlannedTableCount> = {
      source_documents: plannedCount(batchExists ? 0 : 1, batchExists ? 1 : 0),
      workload_import_batches: plannedCount(batchExists ? 0 : 1, batchExists ? 1 : 0),
      workload_import_rows: plannedCount(batchExists ? 0 : 39, rowSkip),
      data_provenance: plannedCount(batchExists ? 0 : 39, provenanceSkip),
      discrepancy_log: plannedCount(batchExists ? 0 : blockerCount, discrepancySkip),
      faculty_profiles: plannedCount(0),
      courses: plannedCount(0),
      course_components: plannedCount(0),
      curriculum_courses: plannedCount(0),
      course_offerings: plannedCount(0),
      offering_audiences: plannedCount(0),
      faculty_assignments: plannedCount(0),
      faculty_subject_preferences: plannedCount(0),
    };
    const plan: WorkloadImportPlan = {
      generatedAt: new Date().toISOString(),
      targetDatabase: 'slotify_dev',
      sourceKey: CSE_WORKLOAD_SOURCE_KEY,
      contentSha256: digest.contentSha256,
      sourceHashes: { page1Sha256: digest.page1Sha256, page2Sha256: digest.page2Sha256 },
      counts,
      rows: preview.rows.map(row => ({
        sourceRow: row.rowNumber,
        page: row.sourcePage,
        sourceName: row.sourceName,
        category: row.facultyCategory,
        rawSubjectsAndHours: subjectSummary(row),
        labDuty: row.labDuty.rawLabel ? `${row.labDuty.rawLabel} / ${row.labDuty.weeklyHours ?? 'unreadable'}h` : '—',
        otherWorkload: `SDP ${row.sdp ?? '—'} / minor project ${row.minorProject ?? '—'}`,
        printedTheoryLabTotal: row.printedLoadSourceText,
        possibleCourseMatches: courseMatches(row),
        unresolved: row.unresolvedFields.join(', ') || row.issues.map(issue => issue.code).join(', ') || 'none',
        destination: `workload_import_rows(source_key=${CSE_WORKLOAD_SOURCE_KEY}, source_row_number=${row.rowNumber})`,
        action: 'STAGE_FOR_REVIEW',
      })),
      masterDataCandidates: {
        departments: preview.masterDataSnapshot.departments,
        faculty: preview.masterDataSnapshot.faculty,
        courses: preview.masterDataSnapshot.courses.map(({ course_id, course_code, course_name, dept_id }) => ({ course_id, course_code, course_name, dept_id })),
        terms: preview.masterDataSnapshot.terms,
        semesterCount: preview.masterDataSnapshot.semesters.length,
        sectionCount: preview.masterDataSnapshot.sections.length,
        batchCount: preview.masterDataSnapshot.batches.length,
        assignmentCount: preview.masterDataSnapshot.assignments.length,
      },
      expectedBlockerIssues: blockerCount,
      executionPolicy: [
        'Insert source-document metadata, one import batch, all 39 source positions (including the missing-row placeholder), one provenance row per source position, and one discrepancy-log record for each blocking issue.',
        'Never insert/update faculty profiles, courses, components, curriculum, offerings, audiences, assignments, or faculty preferences from this workbook without verified mapping and identity resolution.',
        'The source-document term_id remains NULL; the source title and existing term candidate are shown for review, not linked automatically.',
        'A rerun with identical source hashes is a no-op. A changed source hash under the same source key is rejected without overwrite.',
        'All SQL writes run in one transaction. Any failure or count mismatch rolls the transaction back.',
        'Source columns are immutable in the review table; only explicit resolution fields can be changed by an administrator.',
      ],
    };
    await conn.rollback();
    transactionOpen = false;
    fs.writeFileSync(planJsonPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    fs.writeFileSync(planPath, renderPlan(plan), 'utf8');
    console.log(`Plan written: ${path.relative(projectRoot, planPath)}`);
    console.log(JSON.stringify({ targetDatabase: plan.targetDatabase, sourceKey: plan.sourceKey, contentSha256: plan.contentSha256, counts: plan.counts, expectedBlockerIssues: blockerCount }, null, 2));
  } finally {
    if (transactionOpen) await conn.rollback();
    await conn.end();
  }
}

buildPlan().catch(error => {
  console.error('Could not generate workload import plan:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
