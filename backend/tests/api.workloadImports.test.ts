import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exec, pool } from '../src/db/pool';
import { createWorkloadImportPreview } from '../src/services/workloadImportPreview';
import {
  CSE_WORKLOAD_SOURCE_KEY,
  importWorkloadPreview,
  WorkloadSourceDigest,
} from '../src/services/workloadImportService';
import { client, Client, mkUser } from './apiHelpers';

const BACKEND_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(BACKEND_ROOT, '..');
const EXTRACTION = fs.readFileSync(path.join(PROJECT_ROOT, 'docs/imports/CSE_EVEN_2026_extraction.md'), 'utf8');
const PREVIEW = createWorkloadImportPreview(EXTRACTION, {
  departments: [], faculty: [], courses: [], terms: [], semesters: [], sections: [], batches: [],
  curriculumCourses: [], assignments: [],
}, {}, 'fixed-test-time');
const DIGEST: WorkloadSourceDigest = { contentSha256: 'a'.repeat(64), page1Sha256: 'b'.repeat(64), page2Sha256: 'c'.repeat(64) };
const RUN = Date.now().toString(36);

let admin: Client;
let faculty1: Client;
let faculty2: Client;
let student: Client;
let faculty1Id: number;
let faculty2Id: number;
let sourceDocumentId: number | null = null;
let batchId: number | null = null;

async function removeImportFixture() {
  if (sourceDocumentId !== null) {
    await exec("DELETE FROM discrepancy_log WHERE document_id = ?", [sourceDocumentId]);
    await exec("DELETE FROM data_provenance WHERE document_id = ?", [sourceDocumentId]);
    await exec('DELETE FROM workload_import_rows WHERE batch_id = ?', [batchId]);
    await exec('DELETE FROM workload_import_batches WHERE batch_id = ?', [batchId]);
    await exec('DELETE FROM source_documents WHERE document_id = ?', [sourceDocumentId]);
  }
  await exec("DELETE FROM faculty_profiles WHERE user_id IN (SELECT user_id FROM users WHERE username LIKE 'wli\\_%')");
  await exec("DELETE FROM users WHERE username LIKE 'wli\\_%'");
}

beforeAll(async () => {
  const [[db]]: any = await pool.query('SELECT DATABASE() AS name');
  if (db.name !== 'slotify_test') throw new Error(`Refusing to run workload import tests in ${db.name}`);
  await removeImportFixture();
  const adminUser = await mkUser(`wli_admin_${RUN}`, ['ADMIN']);
  const facultyUser1 = await mkUser(`wli_fac1_${RUN}`, ['FACULTY']);
  const facultyUser2 = await mkUser(`wli_fac2_${RUN}`, ['FACULTY']);
  await mkUser(`wli_student_${RUN}`, ['STUDENT']);
  admin = await client(`wli_admin_${RUN}`);
  faculty1 = await client(`wli_fac1_${RUN}`);
  faculty2 = await client(`wli_fac2_${RUN}`);
  student = await client(`wli_student_${RUN}`);
  const [f1]: any = await pool.query('INSERT INTO faculty_profiles (user_id, name, data_status) VALUES (?, ?, ?)', [facultyUser1, 'Fixture Import Faculty One', 'SYNTHETIC']);
  const [f2]: any = await pool.query('INSERT INTO faculty_profiles (user_id, name, data_status) VALUES (?, ?, ?)', [facultyUser2, 'Fixture Import Faculty Two', 'SYNTHETIC']);
  void adminUser;
  faculty1Id = f1.insertId;
  faculty2Id = f2.insertId;
});

afterAll(async () => {
  await removeImportFixture();
  await exec("DELETE FROM users WHERE username LIKE 'wli\\_%'");
  await pool.end();
});

describe('workload source import', () => {
  it('stages the entire source transactionally, detects duplicate runs, and rejects changed sources', async () => {
    await expect((async () => pool.getConnection().then(async conn => {
      try {
        await conn.beginTransaction();
        await importWorkloadPreview(conn, PREVIEW, DIGEST, { page1: 'test/page1.png', page2: 'test/page2.jpe' });
        throw new Error('forced rollback');
      } catch (error) {
        await conn.rollback();
        throw error;
      } finally {
        conn.release();
      }
    }))()).rejects.toThrow('forced rollback');

    const [[afterRollback]]: any = await pool.query(
      'SELECT COUNT(*) AS n FROM workload_import_batches WHERE source_key = ?',
      [CSE_WORKLOAD_SOURCE_KEY],
    );
    expect(Number(afterRollback.n)).toBe(0);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await importWorkloadPreview(conn, PREVIEW, DIGEST, { page1: 'test/page1.png', page2: 'test/page2.jpe' });
      expect(result.inserted).toEqual({ sourceDocuments: 1, batches: 1, sourceRows: 39, provenance: 39, discrepancies: 9 });
      expect(result.masterData).toEqual({
        facultyProfiles: 0, courses: 0, courseComponents: 0, curriculumLinks: 0,
        offerings: 0, audiences: 0, assignments: 0, preferences: 0,
      });
      sourceDocumentId = result.sourceDocumentId;
      batchId = result.batchId;
      await conn.commit();
    } finally {
      conn.release();
    }

    const repeatConnection = await pool.getConnection();
    try {
      await repeatConnection.beginTransaction();
      const repeated = await importWorkloadPreview(repeatConnection, PREVIEW, DIGEST, { page1: 'test/page1.png', page2: 'test/page2.jpe' });
      expect(repeated.idempotentSkip).toBe(true);
      expect(repeated.inserted.sourceRows).toBe(0);
      expect(repeated.skipped).toEqual({ sourceDocuments: 1, batches: 1, sourceRows: 39, provenance: 39, discrepancies: 9 });
      await repeatConnection.rollback();
    } finally {
      repeatConnection.release();
    }

    const changedConnection = await pool.getConnection();
    try {
      await changedConnection.beginTransaction();
      await expect(importWorkloadPreview(
        changedConnection,
        PREVIEW,
        { ...DIGEST, contentSha256: 'd'.repeat(64), page1Sha256: 'e'.repeat(64) },
        { page1: 'test/page1.png', page2: 'test/page2.jpe' },
      )).rejects.toThrow('different source hash');
      await changedConnection.rollback();
    } finally {
      changedConnection.release();
    }
  });

  it('authorizes admin review, validates proposed mappings, and scopes pending rows to the authenticated faculty member', async () => {
    const [all]: any = await pool.query(
      'SELECT workload_import_row_id, raw_source_line FROM workload_import_rows WHERE batch_id = ? ORDER BY source_row_number LIMIT 2',
      [batchId],
    );
    await exec('UPDATE workload_import_rows SET faculty_id = ? WHERE workload_import_row_id = ?', [faculty1Id, all[0].workload_import_row_id]);
    await exec('UPDATE workload_import_rows SET faculty_id = ? WHERE workload_import_row_id = ?', [faculty2Id, all[1].workload_import_row_id]);

    expect((await admin.get('/api/workload-imports')).status).toBe(200);
    expect((await faculty1.get('/api/workload-imports')).status).toBe(403);
    expect((await student.get('/api/workload-imports')).status).toBe(403);
    expect((await student.get('/api/workload-imports/mine')).status).toBe(403);
    const own1 = await faculty1.get('/api/workload-imports/mine');
    const own2 = await faculty2.get('/api/workload-imports/mine');
    expect(own1.status).toBe(200);
    expect(own1.body.data).toHaveLength(1);
    expect(own1.body.data[0].workload_import_row_id).toBe(all[0].workload_import_row_id);
    expect(own2.body.data).toHaveLength(1);
    expect(own2.body.data[0].workload_import_row_id).toBe(all[1].workload_import_row_id);

    const invalidMap = await admin.patch(`/api/workload-imports/${all[0].workload_import_row_id}/review`, {
      resolution_status: 'REVIEWED',
      subject_mappings: { DMS: { course_id: 999999 } },
      review_notes: 'Reject unknown course candidate',
    });
    expect(invalidMap.status).toBe(422);
    const afterInvalid = await pool.query('SELECT raw_source_line FROM workload_import_rows WHERE workload_import_row_id = ?', [all[0].workload_import_row_id]);
    expect((afterInvalid[0] as any[])[0].raw_source_line).toBe(all[0].raw_source_line);

    const reviewed = await admin.patch(`/api/workload-imports/${all[0].workload_import_row_id}/review`, {
      resolution_status: 'REVIEWED',
      faculty_id: faculty1Id,
      review_notes: 'Identity linked for pending source review only; assignment remains unconfirmed.',
    });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.data.resolution_status).toBe('REVIEWED');
    const forbiddenChange = await faculty1.patch(`/api/workload-imports/${all[0].workload_import_row_id}/review`, {
      resolution_status: 'REVIEWED',
      review_notes: 'not authorized',
    });
    expect(forbiddenChange.status).toBe(403);
  });
});
