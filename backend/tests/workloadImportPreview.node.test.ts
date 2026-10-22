import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  createWorkloadImportPreview,
  formatWorkloadImportPreviewMarkdown,
  ImportMasterData,
  parseWorkloadExtraction,
} from '../src/services/workloadImportPreview';

const extraction = fs.readFileSync(
  path.resolve(__dirname, '../../docs/imports/CSE_EVEN_2026_extraction.md'),
  'utf8',
);

function masterData(): ImportMasterData {
  return {
    departments: [{ dept_id: 1, dept_code: 'CSE', dept_name: 'Computer Science and Engineering', is_active: 1 }],
    faculty: [{ faculty_id: 10, name: 'Guest Faculty', staff_code: null, employment_type: 'GUEST', dept_id: 1, designation_id: null, is_active: 1 }],
    courses: [{
      course_id: 20, course_code: 'DBMS', course_name: 'Database Management Systems', credits: 4, dept_id: 1, is_active: 1,
      components: [{ component_id: 30, component_type: 'THEORY', weekly_hours: 3 }],
    }],
    terms: [{ term_id: 40, term_name: 'Even Semester 2026', parity: 'EVEN', status: 'ACTIVE', year_id: 1, year_label: '2025-26', start_date: null, end_date: null }],
    semesters: [{ semester_id: 50, semester_no: 4, name: 'Fourth', scheme_id: 60, program_code: 'CSE' }],
    sections: [{ section_id: 70, term_id: 40, scheme_id: 60, semester_id: 50, section_name: 'A' }],
    batches: [{ batch_id: 80, section_id: 70, batch_name: 'A1', batch_type: 'LAB' }],
    curriculumCourses: [{ course_id: 20, semester_id: 50, scheme_id: 60 }],
    assignments: [],
  };
}

test('parses all source serial numbers and preserves the missing row without inventing values', () => {
  const rows = parseWorkloadExtraction(extraction);
  assert.equal(rows.length, 39);
  const missing = rows.find(row => row.rowNumber === 38);
  assert.ok(missing);
  assert.equal(missing.missingSourceRow, true);
  assert.equal(missing.sourceName, null);
  assert.equal(missing.printedLoad.totalHours, null);
});

test('flags exact duplicate and possible duplicate identities without merging records', () => {
  const preview = createWorkloadImportPreview(extraction, masterData(), {}, 'fixed-time');
  const guestRows = preview.rows.filter(row => [27, 28].includes(row.rowNumber));
  assert.deepEqual(guestRows.map(row => row.duplicateRows), [[28], [27]]);
  assert.ok(guestRows.every(row => row.status === 'BLOCKED'));
  assert.deepEqual(preview.rows.find(row => row.rowNumber === 31)?.duplicateRows, [39]);
  assert.deepEqual(preview.rows.find(row => row.rowNumber === 39)?.duplicateRows, [31]);
});

test('reports missing required mappings and keeps unverified records out of ready status', () => {
  const preview = createWorkloadImportPreview(extraction, masterData(), {}, 'fixed-time');
  assert.equal(preview.status, 'PREVIEW_ONLY');
  assert.equal(preview.writesPerformed, false);
  assert.equal(preview.summary.readyToImport, 0);
  assert.ok(preview.rows.every(row => row.issues.some(issue => issue.code === 'FACULTY_MAPPING_MISSING')));
  assert.ok(preview.rows.every(row => row.issues.some(issue => issue.code === 'TERM_MAPPING_MISSING')));
  assert.ok(preview.rows.every(row => row.issues.some(issue => issue.code === 'SECTION_MAPPING_MISSING') || row.missingSourceRow));
});

test('rejects course, component, semester, section, and batch mappings that violate the schema', () => {
  const mappings = {
    1: {
      departmentId: 999,
      facultyId: 999,
      termId: 404,
      subjects: {
        DMS: { courseId: 20, componentId: 999, semesterId: 999, sectionId: 999, batchId: 80 },
      },
    },
  };
  const preview = createWorkloadImportPreview(extraction, masterData(), mappings, 'fixed-time');
  const codes = preview.rows.find(row => row.rowNumber === 1)!.issues.map(issue => issue.code);
  assert.ok(codes.includes('DEPARTMENT_MAPPING_INVALID'));
  assert.ok(codes.includes('FACULTY_MAPPING_INVALID'));
  assert.ok(codes.includes('TERM_MAPPING_INVALID'));
  assert.ok(codes.includes('COMPONENT_MAPPING_INVALID'));
  assert.ok(codes.includes('SEMESTER_MAPPING_INVALID'));
  assert.ok(codes.includes('SECTION_MAPPING_INVALID'));
  assert.ok(codes.includes('BATCH_MAPPING_INVALID'));

  const invalidCourse = createWorkloadImportPreview(extraction, masterData(), {
    1: { termId: 40, subjects: { DMS: { courseId: 999 } } },
  }, 'fixed-time');
  assert.ok(invalidCourse.rows[0].issues.some(issue => issue.code === 'COURSE_MAPPING_INVALID'));
});

test('flags unverified workload arithmetic, unreadable hours, and ambiguous joining date', () => {
  const preview = createWorkloadImportPreview(extraction, masterData(), {}, 'fixed-time');
  const row25 = preview.rows.find(row => row.rowNumber === 25)!;
  assert.equal(row25.subjects[0].weeklyHours, null);
  assert.equal(row25.printedLoad.theoryHours, null);
  assert.equal(row25.printedLoad.labHours, 5);
  assert.equal(row25.printedLoad.totalHours, 16);
  assert.match(row25.printedLoadSourceText, /handwritten\/unclear theory value/);
  assert.ok(row25.issues.some(issue => issue.code === 'SOURCE_HOURS_UNREADABLE'));
  assert.ok(row25.issues.some(issue => issue.code === 'JOINING_DATE_AMBIGUOUS'));
  assert.ok(row25.issues.some(issue => issue.code === 'LOAD_SUBTOTAL_UNREADABLE'));
});

test('does not mark semester or section mappings ready when mapped IDs are incompatible', () => {
  const data = masterData();
  data.curriculumCourses = [];
  const preview = createWorkloadImportPreview(extraction, data, {
    1: {
      facultyId: 10,
      termId: 40,
      subjects: { DMS: { courseId: 20, componentId: 30, semesterId: 50, sectionId: 70 } },
    },
  }, 'fixed-time');
  const row = preview.rows.find(item => item.rowNumber === 1)!;
  assert.ok(row.issues.some(issue => issue.code === 'COURSE_NOT_IN_SEMESTER'));
  assert.ok(row.status !== 'READY');
});

test('flags TA subject totals that differ from printed total without adjusting either value', () => {
  const preview = createWorkloadImportPreview(extraction, masterData(), {}, 'fixed-time');
  const row29 = preview.rows.find(item => item.rowNumber === 29)!;
  assert.equal(row29.subjects.reduce((sum, subject) => sum + (subject.weeklyHours ?? 0), 0), 22);
  assert.equal(row29.printedLoad.totalHours, 24);
  assert.ok(row29.issues.some(issue => issue.code === 'TA_SUBJECT_TOTAL_MISMATCH'));
});

test('renders a review report with source rows, candidates, unresolved fields, and preview-only warning', () => {
  const preview = createWorkloadImportPreview(extraction, masterData(), {}, 'fixed-time');
  const report = formatWorkloadImportPreviewMarkdown(preview);
  assert.match(report, /PREVIEW ONLY/);
  assert.match(report, /No institutional records or assignments were changed/);
  assert.match(report, /\| 38 \| BLOCKED \| TA \| Missing source row \|/);
  assert.match(report, /CRYPTO NW SEC/);
  assert.match(report, /TA_SUBJECT_TOTAL_MISMATCH/);
});
