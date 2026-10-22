import { RowDataPacket } from 'mysql2/promise';
import { env } from '../config/env';
import { pool } from '../db/pool';

const sourceKey = 'CSE_EVEN_2026_CSE_WORKLOAD_V1';
const masterDataTables = [
  'faculty_profiles',
  'courses',
  'course_components',
  'curriculum_courses',
  'course_offerings',
  'offering_audiences',
  'faculty_assignments',
  'faculty_subject_preferences',
];

async function verifyWorkloadImport() {
  if (env.DB_NAME !== 'slotify_dev') {
    throw new Error(`Refusing to verify DB_NAME=${env.DB_NAME}; expected slotify_dev.`);
  }

  const [batches] = await pool.query<RowDataPacket[]>(
    'SELECT batch_id, source_document_id, status, import_summary FROM workload_import_batches WHERE source_key = ?',
    [sourceKey],
  );
  if (batches.length !== 1) throw new Error(`Expected one source batch, found ${batches.length}.`);
  const batch = batches[0];
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS count FROM workload_import_rows WHERE batch_id = ?',
    [batch.batch_id],
  );
  const [provenance] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM data_provenance
     WHERE document_id = ? AND table_name = 'workload_import_rows' AND record_id IN
       (SELECT workload_import_row_id FROM workload_import_rows WHERE batch_id = ?)`,
    [batch.source_document_id, batch.batch_id],
  );
  const [discrepancies] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM discrepancy_log
     WHERE document_id = ? AND table_name = 'workload_import_rows'`,
    [batch.source_document_id],
  );
  const [reviewStatuses] = await pool.query<RowDataPacket[]>(
    `SELECT resolution_status, COUNT(*) AS count FROM workload_import_rows
     WHERE batch_id = ? GROUP BY resolution_status ORDER BY resolution_status`,
    [batch.batch_id],
  );
  const masterDataCounts: Record<string, number> = {};
  for (const table of masterDataTables) {
    const [counts] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM ${table}`);
    masterDataCounts[table] = Number(counts[0].count);
  }

  const summary = typeof batch.import_summary === 'string'
    ? JSON.parse(batch.import_summary)
    : batch.import_summary;
  const verifiedCounts = {
    sourceRows: Number(rows[0].count),
    provenance: Number(provenance[0].count),
    discrepancies: Number(discrepancies[0].count),
  };
  if (verifiedCounts.sourceRows !== 39 || verifiedCounts.provenance !== 39 ||
      verifiedCounts.discrepancies !== 9 || summary?.execution !== 'COMMITTED') {
    throw new Error(`Committed import verification failed: ${JSON.stringify(verifiedCounts)}.`);
  }

  console.log(JSON.stringify({
    database: env.DB_NAME,
    sourceKey,
    batchId: batch.batch_id,
    sourceDocumentId: batch.source_document_id,
    status: batch.status,
    verifiedCounts,
    reviewStatuses,
    importSummary: summary,
    masterDataCounts,
  }, null, 2));
}

verifyWorkloadImport()
  .catch(error => {
    console.error('Workload import verification failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
