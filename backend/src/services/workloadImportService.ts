import crypto from 'crypto';
import fs from 'fs';
import { Connection, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { WorkloadImportPreview } from './workloadImportPreview';

export const CSE_WORKLOAD_SOURCE_KEY = 'CSE_EVEN_2026_CSE_WORKLOAD_V1';

export interface WorkloadSourceArtifacts {
  markdown: string;
  page1Path: string;
  page2Path: string;
}

export interface WorkloadSourceDigest {
  contentSha256: string;
  page1Sha256: string;
  page2Sha256: string;
}

export function digestWorkloadSource(artifacts: WorkloadSourceArtifacts): WorkloadSourceDigest {
  const page1 = fs.readFileSync(artifacts.page1Path);
  const page2 = fs.readFileSync(artifacts.page2Path);
  const page1Sha256 = crypto.createHash('sha256').update(page1).digest('hex');
  const page2Sha256 = crypto.createHash('sha256').update(page2).digest('hex');
  const sourceRows = artifacts.markdown
    .split(/\r?\n/)
    .filter(line => /^\s*\|\s*\d+\s*\|/.test(line))
    .join('\n');
  const contentSha256 = crypto.createHash('sha256')
    .update(sourceRows)
    .update('\0')
    .update(page1Sha256)
    .update('\0')
    .update(page2Sha256)
    .digest('hex');
  return { contentSha256, page1Sha256, page2Sha256 };
}

export async function matchesPersistedSource(
  conn: PoolConnection | Connection,
  sourceDocumentId: number,
  preview: WorkloadImportPreview,
  digest: WorkloadSourceDigest,
): Promise<boolean> {
  const [documents] = await conn.query<RowDataPacket[]>(
    'SELECT remarks FROM source_documents WHERE document_id = ?',
    [sourceDocumentId],
  );
  const remarks = String(documents[0]?.remarks ?? '');
  const page1Hash = remarks.match(/Page 1: .*?\(SHA-256 ([a-f0-9]{64})\)/)?.[1];
  const page2Hash = remarks.match(/Page 2: .*?\(SHA-256 ([a-f0-9]{64})\)/)?.[1];
  if (page1Hash !== digest.page1Sha256 || page2Hash !== digest.page2Sha256) return false;

  const [storedRows] = await conn.query<RowDataPacket[]>(
    `SELECT source_row_number, source_page, raw_source_line
     FROM workload_import_rows
     WHERE batch_id = (SELECT batch_id FROM workload_import_batches WHERE source_document_id = ?)
     ORDER BY source_row_number`,
    [sourceDocumentId],
  );
  return storedRows.length === preview.rows.length && preview.rows.every((row, index) =>
    Number(storedRows[index].source_row_number) === row.rowNumber &&
    Number(storedRows[index].source_page) === row.sourcePage &&
    storedRows[index].raw_source_line === row.rawSourceLine,
  );
}

export interface WorkloadImportResult {
  batchId: number;
  sourceDocumentId: number;
  idempotentSkip: boolean;
  summaryMetadataUpdates: number;
  inserted: {
    sourceDocuments: number;
    batches: number;
    sourceRows: number;
    provenance: number;
    discrepancies: number;
  };
  skipped: {
    sourceDocuments: number;
    batches: number;
    sourceRows: number;
    provenance: number;
    discrepancies: number;
  };
  masterData: {
    facultyProfiles: number;
    courses: number;
    courseComponents: number;
    curriculumLinks: number;
    offerings: number;
    audiences: number;
    assignments: number;
    preferences: number;
  };
}

export async function importWorkloadPreview(
  conn: PoolConnection,
  preview: WorkloadImportPreview,
  digest: WorkloadSourceDigest,
  sourcePaths: { page1: string; page2: string },
): Promise<WorkloadImportResult> {
  if (preview.rows.length !== 39 || preview.rows.some((row, index) => row.rowNumber !== index + 1)) {
    throw new Error('Workload source must contain serial positions 1 through 39 exactly once.');
  }
  if (preview.rows.some(row => !row.rawSourceLine || (row.sourcePage !== (row.rowNumber <= 21 ? 1 : 2)))) {
    throw new Error('Workload source row is missing its original transcription line or page reference.');
  }

  const [existingRows] = await conn.query<RowDataPacket[]>(
    'SELECT batch_id, source_document_id, content_sha256, import_summary FROM workload_import_batches WHERE source_key = ? FOR UPDATE',
    [CSE_WORKLOAD_SOURCE_KEY],
  );
  if (existingRows[0]) {
    const sourceMaterialMatches = await matchesPersistedSource(
      conn, existingRows[0].source_document_id, preview, digest,
    );
    if (existingRows[0].content_sha256 !== digest.contentSha256 && !sourceMaterialMatches) {
      throw new Error('The source key already exists with a different source hash. Refusing to overwrite imported review data.');
    }
    const [rowCounts] = await conn.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM workload_import_rows WHERE batch_id = ?',
      [existingRows[0].batch_id],
    );
    const [provenanceCounts] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM data_provenance
       WHERE table_name = 'workload_import_rows' AND record_id IN
         (SELECT workload_import_row_id FROM workload_import_rows WHERE batch_id = ?)`,
      [existingRows[0].batch_id],
    );
    const [discrepancyCounts] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM discrepancy_log
       WHERE document_id = ? AND table_name = 'workload_import_rows'`,
      [existingRows[0].source_document_id],
    );
    let summaryMetadataUpdates = 0;
    if (!existingRows[0].import_summary || existingRows[0].content_sha256 !== digest.contentSha256) {
      const summary = {
        execution: 'COMMITTED',
        sourceKey: CSE_WORKLOAD_SOURCE_KEY,
        sourceSha256: digest.contentSha256,
        inserted: {
          sourceDocuments: 1, batches: 1, sourceRows: Number(rowCounts[0].n),
          provenance: Number(provenanceCounts[0].n), discrepancies: Number(discrepancyCounts[0].n),
        },
        updated: 0,
        skipped: 0,
        masterDataChanged: {
          facultyProfiles: 0, courses: 0, courseComponents: 0, curriculumLinks: 0,
          offerings: 0, audiences: 0, assignments: 0, preferences: 0,
        },
      };
      await conn.query('UPDATE workload_import_batches SET content_sha256 = ?, import_summary = ? WHERE batch_id = ?', [
        digest.contentSha256,
        JSON.stringify(summary),
        existingRows[0].batch_id,
      ]);
      summaryMetadataUpdates = 1;
    }
    return {
      batchId: existingRows[0].batch_id,
      sourceDocumentId: existingRows[0].source_document_id,
      idempotentSkip: true,
      summaryMetadataUpdates,
      inserted: { sourceDocuments: 0, batches: 0, sourceRows: 0, provenance: 0, discrepancies: 0 },
      skipped: {
        sourceDocuments: 1,
        batches: 1,
        sourceRows: Number(rowCounts[0].n),
        provenance: Number(provenanceCounts[0].n),
        discrepancies: Number(discrepancyCounts[0].n),
      },
      masterData: {
        facultyProfiles: 0, courses: 0, courseComponents: 0, curriculumLinks: 0,
        offerings: 0, audiences: 0, assignments: 0, preferences: 0,
      },
    };
  }

  const sourceRemarks = [
    'Original pages preserved in project docs/imports/source/.',
    `Page 1: ${sourcePaths.page1} (SHA-256 ${digest.page1Sha256}).`,
    `Page 2: ${sourcePaths.page2} (SHA-256 ${digest.page2Sha256}).`,
    `Combined source/extraction SHA-256: ${digest.contentSha256}.`,
    'Source title indicates Even Semester 2026; no term FK was assigned because the academic-term relationship remains subject to administrator confirmation.',
    'No faculty, course, curriculum, offering, audience, assignment, or preference records are created by this source-review import.',
  ].join(' ');
  const [documentResult] = await conn.query(
    `INSERT INTO source_documents (file_name, source_type, revision, term_id, remarks)
     VALUES (?, 'WORKLOAD_SOURCE_IMAGES', '2026-10-20', NULL, ?)`,
    ['CSE_EVEN_2026_page1.png; CSE_EVEN_2026_page2.jpe', sourceRemarks],
  );
  const sourceDocumentId = Number((documentResult as { insertId: number }).insertId);

  const expectedDiscrepancies = preview.rows.flatMap(row => row.issues.filter(issue => issue.severity === 'BLOCKER')).length;
  const importSummary = {
    execution: 'COMMITTED',
    sourceKey: CSE_WORKLOAD_SOURCE_KEY,
    sourceSha256: digest.contentSha256,
    inserted: {
      sourceDocuments: 1, batches: 1, sourceRows: preview.rows.length,
      provenance: preview.rows.length, discrepancies: expectedDiscrepancies,
    },
    updated: 0,
    skipped: 0,
    masterDataChanged: {
      facultyProfiles: 0, courses: 0, courseComponents: 0, curriculumLinks: 0,
      offerings: 0, audiences: 0, assignments: 0, preferences: 0,
    },
  };
  const [batchResult] = await conn.query(
    `INSERT INTO workload_import_batches (source_key, content_sha256, source_document_id, status, import_summary)
     VALUES (?, ?, ?, 'REVIEW_REQUIRED', ?)`,
    [CSE_WORKLOAD_SOURCE_KEY, digest.contentSha256, sourceDocumentId, JSON.stringify(importSummary)],
  );
  const batchId = Number((batchResult as { insertId: number }).insertId);
  let provenance = 0;
  let discrepancies = 0;

  for (const row of preview.rows) {
    const sourceSnapshot = {
      rowNumber: row.rowNumber,
      sourcePage: row.sourcePage,
      rawSourceLine: row.rawSourceLine,
      sourceName: row.sourceName,
      groupLabel: row.groupLabel,
      facultyCategory: row.facultyCategory,
      subjects: row.subjects,
      labDuty: row.labDuty,
      sdp: row.sdp,
      minorProject: row.minorProject,
      printedLoad: row.printedLoad,
      printedLoadSourceText: row.printedLoadSourceText,
      missingSourceRow: row.missingSourceRow,
      previewStatus: row.status,
      duplicateRows: row.duplicateRows,
      possibleFacultyMatches: row.possibleFacultyMatches,
      subjectMatches: row.subjectMatches,
      issues: row.issues,
    };
    const [rowResult] = await conn.query(
      `INSERT INTO workload_import_rows (
         batch_id, source_row_number, source_page, raw_source_line, source_name, group_label,
         faculty_category, subjects, lab_duty, sdp_hours, minor_project_hours,
         printed_theory_hours, printed_lab_hours, printed_total_hours, printed_load_source_text,
         source_snapshot, unresolved_fields, issues
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        batchId,
        row.rowNumber,
        row.sourcePage,
        row.rawSourceLine,
        row.sourceName,
        row.groupLabel,
        row.facultyCategory,
        JSON.stringify(row.subjects),
        JSON.stringify(row.labDuty),
        row.sdp,
        row.minorProject,
        row.printedLoad.theoryHours,
        row.printedLoad.labHours,
        row.printedLoad.totalHours,
        row.printedLoadSourceText,
        JSON.stringify(sourceSnapshot),
        JSON.stringify(row.unresolvedFields),
        JSON.stringify(row.issues),
      ],
    );
    const recordId = Number((rowResult as { insertId: number }).insertId);
    await conn.query(
      `INSERT INTO data_provenance
         (document_id, table_name, record_id, field_name, source_page, source_row, source_value, normalized_value, data_status)
       VALUES (?, 'workload_import_rows', ?, 'source_snapshot', ?, ?, ?, ?, 'VERIFY')`,
      [
        sourceDocumentId,
        recordId,
        String(row.sourcePage),
        String(row.rowNumber),
        row.rawSourceLine,
        JSON.stringify(sourceSnapshot),
      ],
    );
    provenance += 1;

    for (const issue of row.issues.filter(item => item.severity === 'BLOCKER')) {
      await conn.query(
        `INSERT INTO discrepancy_log
           (document_id, table_name, record_id, field_name, source_value, status, remarks)
         VALUES (?, 'workload_import_rows', ?, ?, ?, 'OPEN', ?)`,
        [
          sourceDocumentId,
          recordId,
          issue.field,
          row.rawSourceLine,
          `${issue.code}: ${issue.message}`,
        ],
      );
      discrepancies += 1;
    }
  }

  return {
    batchId,
    sourceDocumentId,
    idempotentSkip: false,
    summaryMetadataUpdates: 0,
    inserted: {
      sourceDocuments: 1,
      batches: 1,
      sourceRows: preview.rows.length,
      provenance,
      discrepancies,
    },
    skipped: { sourceDocuments: 0, batches: 0, sourceRows: 0, provenance: 0, discrepancies: 0 },
    masterData: {
      facultyProfiles: 0, courses: 0, courseComponents: 0, curriculumLinks: 0,
      offerings: 0, audiences: 0, assignments: 0, preferences: 0,
    },
  };
}
