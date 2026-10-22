import fs from 'fs';
import path from 'path';
import { env } from '../config/env';
import { pool } from '../db/pool';
import { WorkloadImportPreview } from '../services/workloadImportPreview';
import {
  digestWorkloadSource,
  importWorkloadPreview,
  WorkloadImportResult,
  WorkloadSourceArtifacts,
} from '../services/workloadImportService';

const projectRoot = path.resolve(__dirname, '../../../');
const docsRoot = path.join(projectRoot, 'docs/imports');
const sourceRoot = path.join(docsRoot, 'source');
const previewPath = path.join(docsRoot, 'CSE_EVEN_2026_preview.json');
const planPath = path.join(docsRoot, 'CSE_EVEN_2026_import_plan.json');
const extractionPath = path.join(docsRoot, 'CSE_EVEN_2026_extraction.md');
const page1Relative = 'docs/imports/source/CSE_EVEN_2026_page1.png';
const page2Relative = 'docs/imports/source/CSE_EVEN_2026_page2.jpe';

interface ImportPlan {
  targetDatabase: string;
  contentSha256: string;
  counts: Record<string, { insert: number; update: number; skip: number }>;
}

function assertCounts(result: WorkloadImportResult, plan: ImportPlan): void {
  const actual: Record<string, number> = result.idempotentSkip
    ? {
        source_documents: result.skipped.sourceDocuments,
        workload_import_batches: result.skipped.batches,
        workload_import_rows: result.skipped.sourceRows,
        data_provenance: result.skipped.provenance,
        discrepancy_log: result.skipped.discrepancies,
      }
    : {
        source_documents: result.inserted.sourceDocuments,
        workload_import_batches: result.inserted.batches,
        workload_import_rows: result.inserted.sourceRows,
        data_provenance: result.inserted.provenance,
        discrepancy_log: result.inserted.discrepancies,
      };
  for (const [table, count] of Object.entries(actual)) {
    const expected = result.idempotentSkip
      ? (plan.counts[table]?.insert ?? 0) + (plan.counts[table]?.skip ?? 0)
      : plan.counts[table]?.insert;
    if (expected !== count) {
      throw new Error(`Plan mismatch for ${table}: planned ${expected}, actual ${count}. Transaction will roll back.`);
    }
  }
  for (const table of [
    'faculty_profiles', 'courses', 'course_components', 'curriculum_courses',
    'course_offerings', 'offering_audiences', 'faculty_assignments', 'faculty_subject_preferences',
  ]) {
    if ((plan.counts[table]?.insert ?? 0) !== 0 || (plan.counts[table]?.update ?? 0) !== 0) {
      throw new Error(`Unsafe master-data mutation appeared in plan for ${table}. Transaction will roll back.`);
    }
  }
}

async function runImport() {
  if (env.DB_NAME !== 'slotify_dev') {
    throw new Error(`Refusing to import with DB_NAME=${env.DB_NAME}; target must be slotify_dev.`);
  }
  const markdown = fs.readFileSync(extractionPath, 'utf8');
  const preview = JSON.parse(fs.readFileSync(previewPath, 'utf8')) as WorkloadImportPreview;
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8')) as ImportPlan;
  const artifacts: WorkloadSourceArtifacts = {
    markdown,
    page1Path: path.join(sourceRoot, 'CSE_EVEN_2026_page1.png'),
    page2Path: path.join(sourceRoot, 'CSE_EVEN_2026_page2.jpe'),
  };
  const digest = digestWorkloadSource(artifacts);
  if (preview.writesPerformed !== false || plan.targetDatabase !== 'slotify_dev' ||
      preview.rows.length !== 39 || digest.contentSha256 !== plan.contentSha256) {
    throw new Error('Preview, source images, or final import plan do not match. Regenerate the plan and review it before import.');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await importWorkloadPreview(conn, preview, digest, {
      page1: page1Relative,
      page2: page2Relative,
    });
    assertCounts(result, plan);
    await conn.commit();
    console.log(JSON.stringify({
      targetDatabase: 'slotify_dev',
      idempotentSkip: result.idempotentSkip,
      summaryMetadataUpdates: result.summaryMetadataUpdates,
      batchId: result.batchId,
      sourceDocumentId: result.sourceDocumentId,
      inserted: result.inserted,
      skipped: result.skipped,
      masterDataChanged: result.masterData,
      transaction: 'COMMITTED',
    }, null, 2));
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
    await pool.end();
  }
}

runImport().catch(error => {
  console.error('Workload source import failed; transaction rolled back:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
