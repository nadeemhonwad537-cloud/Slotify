import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { env } from '../config/env';
import {
  createWorkloadImportPreview,
  formatWorkloadImportPreviewMarkdown,
  ImportMasterData,
} from '../services/workloadImportPreview';

const projectRoot = path.resolve(__dirname, '../../../');
const extractionPath = path.join(projectRoot, 'docs/imports/CSE_EVEN_2026_extraction.md');
const previewPath = path.join(projectRoot, 'docs/imports/CSE_EVEN_2026_preview.json');
const reportPath = path.join(projectRoot, 'docs/imports/CSE_EVEN_2026_preview.md');

async function buildPreview() {
  const markdown = fs.readFileSync(extractionPath, 'utf8');
  const conn = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: 'slotify_dev',
    multipleStatements: false,
  });

  let transactionOpen = false;
  try {
    await conn.query('START TRANSACTION READ ONLY');
    transactionOpen = true;
    const [departments] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT dept_id, dept_code, dept_name, is_active FROM departments ORDER BY dept_id',
    );
    const [faculty] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT faculty_id, name, staff_code, employment_type, dept_id, designation_id, is_active
       FROM faculty_profiles ORDER BY faculty_id`,
    );
    const [courseRows] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT course_id, course_code, course_name, credits, dept_id, is_active FROM courses ORDER BY course_id',
    );
    const [components] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT component_id, course_id, component_type, weekly_hours FROM course_components ORDER BY course_id, component_id',
    );
    const [terms] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT t.term_id, t.term_name, t.parity, t.status, t.year_id, ay.year_label, t.start_date, t.end_date
       FROM terms t JOIN academic_years ay ON ay.year_id = t.year_id ORDER BY t.term_id`,
    );
    const [semesters] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT s.semester_id, s.semester_no, s.name, s.scheme_id, p.program_code
       FROM semesters s
       JOIN curriculum_schemes cs ON cs.scheme_id = s.scheme_id
       JOIN programs p ON p.program_id = cs.program_id
       ORDER BY s.semester_id`,
    );
    const [sections] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT section_id, term_id, scheme_id, semester_id, section_name FROM sections ORDER BY section_id',
    );
    const [batches] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT batch_id, section_id, batch_name, batch_type FROM batches ORDER BY batch_id',
    );
    const [curriculumCourses] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT course_id, semester_id, scheme_id FROM curriculum_courses ORDER BY semester_id, course_id',
    );
    const [assignments] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT fa.assignment_id, fp.name AS faculty_name, c.course_code, c.course_name,
              cc.component_type, co.term_id, oa.section_id, oa.batch_id, fa.is_approved
       FROM faculty_assignments fa
       JOIN faculty_profiles fp ON fp.faculty_id = fa.faculty_id
       JOIN offering_audiences oa ON oa.audience_id = fa.audience_id
       JOIN course_offerings co ON co.offering_id = oa.offering_id
       JOIN course_components cc ON cc.component_id = co.component_id
       JOIN courses c ON c.course_id = cc.course_id
       ORDER BY fa.assignment_id`,
    );
    await conn.rollback();
    transactionOpen = false;

    const masterData: ImportMasterData = {
      departments: departments as ImportMasterData['departments'],
      faculty: faculty as ImportMasterData['faculty'],
      courses: courseRows.map(course => ({
        ...course,
        components: components
          .filter(component => component.course_id === course.course_id)
          .map(({ component_id, component_type, weekly_hours }) => ({ component_id, component_type, weekly_hours })),
      })) as ImportMasterData['courses'],
      terms: terms as ImportMasterData['terms'],
      semesters: semesters as ImportMasterData['semesters'],
      sections: sections as ImportMasterData['sections'],
      batches: batches as ImportMasterData['batches'],
      curriculumCourses: curriculumCourses as ImportMasterData['curriculumCourses'],
      assignments: assignments as ImportMasterData['assignments'],
    };
    const preview = createWorkloadImportPreview(markdown, masterData);
    fs.writeFileSync(previewPath, `${JSON.stringify(preview, null, 2)}\n`, 'utf8');
    fs.writeFileSync(reportPath, formatWorkloadImportPreviewMarkdown(preview), 'utf8');
    console.log(`Wrote preview only: ${path.relative(projectRoot, previewPath)} and ${path.relative(projectRoot, reportPath)}`);
    console.log(JSON.stringify(preview.summary));
    console.log('Database access: slotify_dev, read-only transaction; no database writes performed.');
  } finally {
    if (transactionOpen) await conn.rollback();
    await conn.end();
  }
}

buildPreview().catch(error => {
  console.error('Could not build the workload preview:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
