export type FacultyCategory = 'REGULAR_CANDIDATE' | 'GUEST' | 'TA' | 'UNKNOWN';
export type PreviewStatus = 'READY' | 'NEEDS_REVIEW' | 'BLOCKED';

export interface SourceSubject {
  column: 'Subject-I' | 'Subject-II' | 'Subject-III';
  rawLabel: string | null;
  weeklyHours: number | null;
  semesterMarkers: string[];
}

export interface SourceWorkloadRow {
  rowNumber: number;
  sourcePage: 1 | 2;
  rawSourceLine: string;
  sourceName: string | null;
  groupLabel: string;
  facultyCategory: FacultyCategory;
  subjects: SourceSubject[];
  labDuty: { rawLabel: string | null; weeklyHours: number | null };
  sdp: number | null;
  minorProject: number | null;
  printedLoad: { theoryHours: number | null; labHours: number | null; totalHours: number | null };
  printedLoadSourceText: string;
  unresolvedFields: string[];
  missingSourceRow: boolean;
}

export interface FacultyCandidate {
  faculty_id: number;
  name: string;
  staff_code: string | null;
  employment_type: string | null;
  dept_id: number | null;
  designation_id: number | null;
  is_active: number;
}

export interface CourseCandidate {
  course_id: number;
  course_code: string | null;
  course_name: string;
  credits: number | string | null;
  dept_id: number | null;
  is_active: number;
  components: Array<{ component_id: number; component_type: string; weekly_hours: number | string | null }>;
}

export interface ImportMasterData {
  departments: Array<{ dept_id: number; dept_code: string; dept_name: string; is_active: number }>;
  faculty: FacultyCandidate[];
  courses: CourseCandidate[];
  terms: Array<{
    term_id: number; term_name: string; parity: 'ODD' | 'EVEN'; status: string;
    year_id: number; year_label: string; start_date: string | null; end_date: string | null;
  }>;
  semesters: Array<{ semester_id: number; semester_no: number; name: string | null; scheme_id: number; program_code: string }>;
  sections: Array<{ section_id: number; term_id: number; scheme_id: number; semester_id: number; section_name: string }>;
  batches: Array<{ batch_id: number; section_id: number; batch_name: string; batch_type: string }>;
  curriculumCourses: Array<{ course_id: number; semester_id: number; scheme_id: number }>;
  assignments: Array<{
    assignment_id: number; faculty_name: string; course_code: string | null; course_name: string;
    component_type: string; term_id: number; section_id: number; batch_id: number | null; is_approved: number;
  }>;
}

export interface SubjectMapping {
  courseId: number;
  componentId?: number;
  semesterId?: number;
  sectionId?: number;
  batchId?: number;
}

export interface RowMapping {
  departmentId?: number;
  facultyId?: number;
  termId?: number;
  subjects?: Record<string, SubjectMapping>;
}

export type ImportMappings = Record<number, RowMapping>;

export interface PreviewIssue {
  code: string;
  field: string;
  severity: 'REVIEW' | 'BLOCKER';
  message: string;
}

export interface PreviewRow extends SourceWorkloadRow {
  status: PreviewStatus;
  duplicateRows: number[];
  possibleFacultyMatches: FacultyCandidate[];
  subjectMatches: Array<{
    rawLabel: string;
    candidates: Array<{
      course_id: number;
      course_code: string | null;
      course_name: string;
      component_types: string[];
      match: 'CODE' | 'NAME' | 'ACRONYM' | 'PREFIX';
    }>;
  }>;
  issues: PreviewIssue[];
}

export interface WorkloadImportPreview {
  generatedAt: string;
  status: 'PREVIEW_ONLY';
  writesPerformed: false;
  source: {
    document: string;
    termLabel: string;
    departmentLabel: string;
    originalImages: string[];
  };
  targetDatabase: string;
  summary: { readyToImport: number; needsReview: number; blocked: number; totalSourceRows: number };
  masterDataSnapshot: ImportMasterData;
  rows: PreviewRow[];
}

const SUBJECT_COLUMNS = ['Subject-I', 'Subject-II', 'Subject-III'] as const;
const EMPTY = /^(?:—|-|)$/;

function cleanCell(value: string): string {
  return value.trim().replace(/^\*\*|\*\*$/g, '').replace(/^["“]|["”]$/g, '').trim();
}

function parseHoursCell(value: string): { rawLabel: string | null; weeklyHours: number | null } {
  const cell = cleanCell(value);
  if (EMPTY.test(cell)) return { rawLabel: null, weeklyHours: null };
  const hours = cell.match(/^(.*?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/);
  if (!hours) return { rawLabel: cell, weeklyHours: null };
  return { rawLabel: cleanCell(hours[1]) || null, weeklyHours: Number(hours[2]) };
}

function parseLoad(value: string): SourceWorkloadRow['printedLoad'] {
  const parts = cleanCell(value).split('/').map(part => part.trim());
  const number = (part: string | undefined) => part && /^\d+(?:\.\d+)?$/.test(part) ? Number(part) : null;
  const totalHours = number(parts[parts.length - 1]);
  const beforeTotal = parts.slice(0, -1);
  const labHours = number(beforeTotal[beforeTotal.length - 1]);
  const theoryHours = beforeTotal.length >= 2
    ? number(beforeTotal.slice(0, -1).join('/'))
    : null;
  return {
    theoryHours,
    labHours,
    totalHours,
  };
}

function semesterMarkers(subjects: SourceSubject[], labDuty: string | null): string[] {
  const text = [...subjects.map(subject => subject.rawLabel ?? ''), labDuty ?? ''].join(' ');
  return [...new Set(text.match(/\b\d+(?:st|nd|rd|th)\b|\b\d+\s*SEM\b/gi) ?? [])];
}

function parseFacultyCategory(group: string): FacultyCategory {
  if (/PART TIME FACULTY/i.test(group)) return 'GUEST';
  if (/TA BLOCK/i.test(group)) return 'TA';
  if (/MAIN BLOCK/i.test(group)) return 'REGULAR_CANDIDATE';
  return 'UNKNOWN';
}

function rowUnresolvedFields(rowNumber: number, name: string | null, subjects: SourceSubject[], load: SourceWorkloadRow['printedLoad'], missing: boolean) {
  const unresolved = new Set<string>();
  if (missing) unresolved.add('SOURCE_ROW_MISSING');
  if (!name) unresolved.add('FACULTY_NAME_MISSING');
  else if (/^(?:guest faculty|new staff)\b/i.test(name) || /(?:^|\s)[A-Z]\.?$/i.test(name)) unresolved.add('FACULTY_IDENTITY_INCOMPLETE');
  if (subjects.some(subject => subject.rawLabel && subject.weeklyHours === null)) unresolved.add('SUBJECT_HOURS_UNREADABLE');
  if (rowNumber === 25 && load.totalHours !== null && (load.theoryHours === null || load.labHours === null)) {
    unresolved.add('LOAD_SUBTOTAL_UNREADABLE');
  } else if (load.totalHours !== null && (load.theoryHours === null || load.labHours === null)) {
    unresolved.add('LOAD_SUBTOTAL_NOT_REPORTED');
  }
  if (rowNumber === 21) unresolved.add('HANDWRITTEN_ANNOTATION_UNREADABLE');
  if (rowNumber === 25) unresolved.add('JOINING_DATE_AMBIGUOUS');
  return [...unresolved];
}

export function parseWorkloadExtraction(markdown: string): SourceWorkloadRow[] {
  const rows: SourceWorkloadRow[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trimStart().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map(cleanCell);
    if (cells.length < 10 || !/^\d+$/.test(cells[0])) continue;

    const rowNumber = Number(cells[0]);
    const missingSourceRow = /no row visible/i.test(cells[1]);
    const sourceName = missingSourceRow || EMPTY.test(cells[1]) ? null : cells[1];
    const subjects: SourceSubject[] = SUBJECT_COLUMNS.map((column, index) => ({
      column,
      ...parseHoursCell(cells[index + 3]),
      semesterMarkers: [],
    }));
    const labDuty = parseHoursCell(cells[6]);
    const printedLoad = parseLoad(cells[9]);
    const markers = semesterMarkers(subjects, labDuty.rawLabel);
    for (const subject of subjects) {
      subject.semesterMarkers = semesterMarkers([subject], null);
    }

    rows.push({
      rowNumber,
      sourcePage: rowNumber <= 21 ? 1 : 2,
      rawSourceLine: line,
      sourceName,
      groupLabel: cells[2],
      facultyCategory: parseFacultyCategory(cells[2]),
      subjects,
      labDuty,
      sdp: /^\d+$/.test(cells[7]) ? Number(cells[7]) : null,
      minorProject: /^\d+$/.test(cells[8]) ? Number(cells[8]) : null,
      printedLoad,
      printedLoadSourceText: cells[9],
      unresolvedFields: rowUnresolvedFields(rowNumber, sourceName, subjects, printedLoad, missingSourceRow),
      missingSourceRow,
    });

    if (markers.length > 0 && !subjects.some(subject => subject.semesterMarkers.length > 0)) {
      const last = rows[rows.length - 1];
      last.unresolvedFields.push('SEMESTER_MARKER_IN_LAB_DUTY');
    }
  }
  return rows;
}

function normalizeName(value: string): string {
  return value
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^(?:dr|mr|mrs|ms|miss)\.?\s+/i, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function duplicateGroups(rows: SourceWorkloadRow[]): Map<number, number[]> {
  const groups = new Map<number, Set<number>>();
  const namedRows = rows.filter(row => row.sourceName);
  for (let i = 0; i < namedRows.length; i++) {
    const left = normalizeName(namedRows[i].sourceName!);
    for (let j = i + 1; j < namedRows.length; j++) {
      const right = normalizeName(namedRows[j].sourceName!);
      const exact = left === right;
      const possible = !exact && Math.min(left.length, right.length) >= 7 && (left.startsWith(right) || right.startsWith(left));
      if (!exact && !possible) continue;
      const leftRow = namedRows[i].rowNumber;
      const rightRow = namedRows[j].rowNumber;
      if (!groups.has(leftRow)) groups.set(leftRow, new Set());
      if (!groups.has(rightRow)) groups.set(rightRow, new Set());
      groups.get(leftRow)!.add(rightRow);
      groups.get(rightRow)!.add(leftRow);
    }
  }
  return new Map([...groups].map(([row, matches]) => [row, [...matches].sort((a, b) => a - b)]));
}

function candidateMatch(label: string, course: CourseCandidate): PreviewRow['subjectMatches'][number]['candidates'][number]['match'] | null {
  const raw = normalizeName(label);
  const code = normalizeName(course.course_code ?? '');
  const name = normalizeName(course.course_name);
  if (code && raw === code) return 'CODE';
  if (raw === name) return 'NAME';
  const acronym = course.course_name
    .split(/[^A-Za-z0-9]+/)
    .filter(word => word && !['and', 'of', 'the'].includes(word.toLowerCase()))
    .map(word => word[0])
    .join('')
    .toUpperCase();
  if (raw === acronym) return 'ACRONYM';
  if (raw.length >= 4 && (name.includes(raw) || raw.includes(name))) return 'PREFIX';
  const firstToken = label.split(/[^A-Za-z0-9]+/).find(Boolean)?.toUpperCase() ?? '';
  const firstCourseWord = course.course_name.split(/[^A-Za-z0-9]+/).find(Boolean)?.toUpperCase() ?? '';
  if (firstToken.length >= 5 && firstCourseWord.startsWith(firstToken)) return 'PREFIX';
  return null;
}

function findSubjectMatches(rows: SourceWorkloadRow[], courses: CourseCandidate[]) {
  const labels = new Set(rows.flatMap(row => row.subjects.map(subject => subject.rawLabel).filter((label): label is string => !!label)));
  labels.add(''); // keep return type inference simple; removed below
  labels.delete('');
  return [...labels].sort().map(rawLabel => ({
    rawLabel,
    candidates: courses.flatMap(course => {
      const match = candidateMatch(rawLabel.replace(/\b\d+(?:st|nd|rd|th)\b|\b\d+\s*SEM\b/gi, '').trim(), course);
      return match ? [{
        course_id: course.course_id,
        course_code: course.course_code,
        course_name: course.course_name,
        component_types: course.components.map(component => component.component_type),
        match,
      }] : [];
    }),
  }));
}

function rowFacultyMatches(name: string | null, faculty: FacultyCandidate[]) {
  if (!name) return [];
  const normalized = normalizeName(name);
  return faculty.filter(candidate => {
    const existing = normalizeName(candidate.name);
    return normalized === existing || (Math.min(normalized.length, existing.length) >= 7 && (normalized.startsWith(existing) || existing.startsWith(normalized)));
  });
}

function validateMappings(
  row: SourceWorkloadRow,
  master: ImportMasterData,
  mapping: RowMapping | undefined,
): PreviewIssue[] {
  const issues: PreviewIssue[] = [];
  const issue = (code: string, field: string, severity: PreviewIssue['severity'], message: string) => {
    issues.push({ code, field, severity, message });
  };
  const department = mapping?.departmentId === undefined
    ? undefined
    : master.departments.find(item => item.dept_id === mapping.departmentId && item.is_active === 1);
  if (mapping?.departmentId === undefined) issue('DEPARTMENT_MAPPING_MISSING', 'departmentId', 'REVIEW', 'Confirm the department record for the source sheet.');
  else if (!department) issue('DEPARTMENT_MAPPING_INVALID', 'departmentId', 'BLOCKER', 'Mapped department does not exist or is inactive.');
  const faculty = mapping?.facultyId === undefined ? undefined : master.faculty.find(item => item.faculty_id === mapping.facultyId && item.is_active === 1);
  if (mapping?.facultyId === undefined) issue('FACULTY_MAPPING_MISSING', 'facultyId', 'REVIEW', 'No explicit faculty profile mapping has been confirmed.');
  else if (!faculty) issue('FACULTY_MAPPING_INVALID', 'facultyId', 'BLOCKER', 'Mapped faculty profile does not exist or is inactive.');
  else if (department && faculty.dept_id !== null && faculty.dept_id !== department.dept_id) {
    issue('FACULTY_DEPARTMENT_MISMATCH', 'facultyId', 'BLOCKER', 'Mapped faculty profile belongs to a different department.');
  } else if (department && faculty.dept_id === null) {
    issue('FACULTY_DEPARTMENT_UNVERIFIED', 'facultyId', 'REVIEW', 'Mapped faculty profile has no department assigned.');
  }

  const term = mapping?.termId === undefined ? undefined : master.terms.find(item => item.term_id === mapping.termId);
  if (mapping?.termId === undefined) issue('TERM_MAPPING_MISSING', 'termId', 'REVIEW', 'Confirm which academic term record this sheet belongs to.');
  else if (!term || term.status === 'CLOSED') issue('TERM_MAPPING_INVALID', 'termId', 'BLOCKER', 'Mapped academic term does not exist or is closed.');

  const sourceSubjects = row.subjects.filter(subject => subject.rawLabel);
  for (const subject of sourceSubjects) {
    const target = mapping?.subjects?.[subject.rawLabel!];
    if (!target) {
      issue('COURSE_MAPPING_MISSING', `subjects.${subject.column}`, 'REVIEW', `No canonical course/component mapping is confirmed for "${subject.rawLabel}".`);
      issue('SEMESTER_MAPPING_MISSING', `subjects.${subject.column}`, 'REVIEW', `No curriculum semester mapping is confirmed for "${subject.rawLabel}".`);
      issue('SECTION_MAPPING_MISSING', `subjects.${subject.column}`, 'REVIEW', 'A term-specific teaching section/audience is not identified in the source.');
      issue('BATCH_MAPPING_MISSING', `subjects.${subject.column}`, 'REVIEW', 'Confirm whether this assignment is section-wide or requires a lab/tutorial batch.');
      continue;
    }
    const course = master.courses.find(item => item.course_id === target.courseId && item.is_active === 1);
    if (!course) {
      issue('COURSE_MAPPING_INVALID', `subjects.${subject.column}`, 'BLOCKER', `Mapped course for "${subject.rawLabel}" does not exist or is inactive.`);
      continue;
    }
    if (department && course.dept_id !== null && course.dept_id !== department.dept_id) {
      issue('COURSE_DEPARTMENT_MISMATCH', `subjects.${subject.column}`, 'BLOCKER', `Mapped course ${course.course_id} belongs to a different department.`);
    } else if (department && course.dept_id === null) {
      issue('COURSE_DEPARTMENT_UNVERIFIED', `subjects.${subject.column}`, 'REVIEW', `Mapped course ${course.course_id} has no department assigned.`);
    }
    if (target.componentId !== undefined && !course.components.some(component => component.component_id === target.componentId)) {
      issue('COMPONENT_MAPPING_INVALID', `subjects.${subject.column}`, 'BLOCKER', `Mapped component does not belong to course ${course.course_id}.`);
    } else if (target.componentId === undefined) {
      issue('COMPONENT_MAPPING_MISSING', `subjects.${subject.column}`, 'REVIEW', `No course component type is confirmed for "${subject.rawLabel}".`);
    } else {
      const component = course.components.find(item => item.component_id === target.componentId);
      if (component?.weekly_hours !== null && component?.weekly_hours !== undefined &&
          subject.weeklyHours !== null && Number(component.weekly_hours) !== subject.weeklyHours) {
        issue('SOURCE_COMPONENT_HOURS_DIFFER', `subjects.${subject.column}`, 'REVIEW', `Source shows ${subject.weeklyHours} weekly hours; selected course component stores ${component.weekly_hours}. Confirm whether these values describe the same workload.`);
      } else if (component?.weekly_hours === null || component?.weekly_hours === undefined) {
        issue('COMPONENT_HOURS_UNVERIFIED', `subjects.${subject.column}`, 'REVIEW', 'Selected course component has no verified weekly-hour value.');
      }
    }
    const semester = target.semesterId === undefined ? undefined : master.semesters.find(item => item.semester_id === target.semesterId);
    if (target.semesterId === undefined) issue('SEMESTER_MAPPING_MISSING', `subjects.${subject.column}`, 'REVIEW', `No curriculum semester mapping is confirmed for "${subject.rawLabel}".`);
    else if (!semester) issue('SEMESTER_MAPPING_INVALID', `subjects.${subject.column}`, 'BLOCKER', 'Mapped semester does not exist.');
    else if (!master.curriculumCourses.some(link => link.course_id === course.course_id && link.semester_id === semester.semester_id && link.scheme_id === semester.scheme_id)) {
      issue('COURSE_NOT_IN_SEMESTER', `subjects.${subject.column}`, 'BLOCKER', `Course ${course.course_id} is not linked to semester ${semester.semester_id} in the current curriculum.`);
    }
    if (semester && term && ((semester.semester_no % 2 === 0 ? 'EVEN' : 'ODD') !== term.parity)) {
      issue('TERM_SEMESTER_PARITY_CONFLICT', `subjects.${subject.column}`, 'BLOCKER', `Semester ${semester.semester_no} conflicts with ${term.parity} term parity.`);
    }
    if (semester && subject.semesterMarkers.length > 0 && subject.semesterMarkers.some(marker => Number(marker.match(/\d+/)?.[0]) !== semester.semester_no)) {
      issue('SOURCE_SEMESTER_MISMATCH', `subjects.${subject.column}`, 'BLOCKER', 'Mapped semester conflicts with the semester marker printed beside this subject.');
    }
    const section = target.sectionId === undefined ? undefined : master.sections.find(item => item.section_id === target.sectionId);
    if (target.sectionId === undefined) issue('SECTION_MAPPING_MISSING', `subjects.${subject.column}`, 'REVIEW', 'A term-specific teaching section/audience is not identified in the source.');
    else if (!section || (term && section.term_id !== term.term_id) || (semester && (section.semester_id !== semester.semester_id || section.scheme_id !== semester.scheme_id))) {
      issue('SECTION_MAPPING_INVALID', `subjects.${subject.column}`, 'BLOCKER', 'Mapped section does not match the selected term and semester.');
    }
    if (target.batchId !== undefined) {
      const batch = master.batches.find(item => item.batch_id === target.batchId);
      if (!batch || !section || batch.section_id !== section.section_id) {
        issue('BATCH_MAPPING_INVALID', `subjects.${subject.column}`, 'BLOCKER', 'Mapped batch does not belong to the mapped section.');
      }
    } else {
      issue('BATCH_MAPPING_MISSING', `subjects.${subject.column}`, 'REVIEW', 'Confirm whether this assignment is section-wide or requires a lab/tutorial batch.');
    }
  }

  if (row.facultyCategory === 'TA' && row.printedLoad.totalHours !== null &&
      row.subjects.every(subject => subject.weeklyHours !== null)) {
    const sourceSubjectTotal = row.subjects.reduce((sum, subject) => sum + (subject.weeklyHours ?? 0), 0);
    if (sourceSubjectTotal !== row.printedLoad.totalHours) {
      issue('TA_SUBJECT_TOTAL_MISMATCH', 'printedLoad.totalHours', 'BLOCKER', `Visible TA subject-hour sum (${sourceSubjectTotal}) differs from printed total (${row.printedLoad.totalHours}); verify source accounting.`);
    }
  }

  if (row.printedLoad.totalHours !== null && row.printedLoad.theoryHours !== null && row.printedLoad.labHours !== null &&
      row.printedLoad.theoryHours + row.printedLoad.labHours !== row.printedLoad.totalHours) {
    issue('PRINTED_LOAD_TOTAL_MISMATCH', 'printedLoad', 'BLOCKER', 'Printed theory and lab subtotals do not equal the printed total.');
  }
  if (row.unresolvedFields.includes('SUBJECT_HOURS_UNREADABLE')) {
    issue('SOURCE_HOURS_UNREADABLE', 'subjects', 'BLOCKER', 'At least one subject-hour value is unclear in the source image.');
  }
  if (row.unresolvedFields.includes('LOAD_SUBTOTAL_UNREADABLE')) {
    issue('LOAD_SUBTOTAL_UNREADABLE', 'printedLoad', 'BLOCKER', 'A printed theory/lab subtotal is missing or unreadable.');
  }
  if (row.unresolvedFields.includes('LOAD_SUBTOTAL_NOT_REPORTED')) {
    issue('LOAD_SUBTOTAL_NOT_REPORTED', 'printedLoad', 'REVIEW', 'Theory and lab subtotals are blank in the source; only total workload is shown.');
  }
  if (row.unresolvedFields.includes('SEMESTER_MARKER_IN_LAB_DUTY')) {
    issue('SEMESTER_MARKER_IN_LAB_DUTY', 'labDuty', 'REVIEW', 'A semester marker appears in the lab-duty text, not in a mapped subject/course field.');
  }
  if (row.missingSourceRow) issue('SOURCE_ROW_MISSING', 'rowNumber', 'BLOCKER', 'Serial number appears in the sheet, but no faculty/workload row is visible.');
  return issues;
}

export function createWorkloadImportPreview(
  markdown: string,
  masterData: ImportMasterData,
  mappings: ImportMappings = {},
  generatedAt = new Date().toISOString(),
): WorkloadImportPreview {
  const sourceRows = parseWorkloadExtraction(markdown);
  const duplicates = duplicateGroups(sourceRows);
  const sharedSubjectMatches = findSubjectMatches(sourceRows, masterData.courses);
  const subjectMatchesByLabel = new Map(sharedSubjectMatches.map(match => [match.rawLabel, match.candidates]));
  const rows: PreviewRow[] = sourceRows.map(row => {
    const issues: PreviewIssue[] = validateMappings(row, masterData, mappings[row.rowNumber]);
    const duplicateRows = duplicates.get(row.rowNumber) ?? [];
    if (duplicateRows.length > 0) {
      issues.push({
        code: 'POSSIBLE_DUPLICATE_FACULTY',
        field: 'sourceName',
        severity: 'BLOCKER',
        message: `Possible duplicate identity with source row(s) ${duplicateRows.join(', ')}; do not merge automatically.`,
      });
    }
    if (row.unresolvedFields.includes('FACULTY_IDENTITY_INCOMPLETE')) {
      issues.push({ code: 'FACULTY_IDENTITY_INCOMPLETE', field: 'sourceName', severity: 'REVIEW', message: 'Source name is generic or incomplete; confirm identity against the college roster.' });
    }
    if (row.unresolvedFields.includes('JOINING_DATE_AMBIGUOUS')) {
      issues.push({ code: 'JOINING_DATE_AMBIGUOUS', field: 'joiningDate', severity: 'BLOCKER', message: 'Source date 7/9/2026 has two plausible date formats; no date was selected.' });
    }
    if (row.unresolvedFields.includes('HANDWRITTEN_ANNOTATION_UNREADABLE')) {
      issues.push({ code: 'HANDWRITTEN_ANNOTATION_UNREADABLE', field: 'annotation', severity: 'REVIEW', message: 'Handwritten annotation is not reliably legible and was not transcribed.' });
    }
    const facultyMatches = rowFacultyMatches(row.sourceName, masterData.faculty);
    if (!mappings[row.rowNumber]?.facultyId && facultyMatches.length > 0) {
      issues.push({ code: 'FACULTY_MATCH_REQUIRES_CONFIRMATION', field: 'facultyId', severity: 'REVIEW', message: 'Possible existing faculty profile found; administrator confirmation is required.' });
    }
    if (row.sourceName && facultyMatches.length === 0) {
      issues.push({ code: 'NO_EXISTING_FACULTY_MATCH', field: 'facultyId', severity: 'REVIEW', message: 'No active existing faculty profile matched this source name; identity/creation decision is required.' });
    }
    const status: PreviewStatus = issues.some(item => item.severity === 'BLOCKER')
      ? 'BLOCKED'
      : issues.length > 0 ? 'NEEDS_REVIEW' : 'READY';
    return {
      ...row,
      status,
      duplicateRows,
      possibleFacultyMatches: facultyMatches,
      subjectMatches: [...new Set(row.subjects.map(subject => subject.rawLabel).filter((label): label is string => !!label))]
        .map(rawLabel => ({ rawLabel, candidates: subjectMatchesByLabel.get(rawLabel) ?? [] })),
      issues,
    };
  });
  return {
    generatedAt,
    status: 'PREVIEW_ONLY',
    writesPerformed: false,
    source: {
      document: 'CSE workload sheet — Even Semester 2026',
      termLabel: 'Even Semester 2026',
      departmentLabel: 'CSE Dept',
      originalImages: [
        'Pasted Image.png (serial rows 1–21)',
        'Pasted Image 2.jpe (serial rows 22–39)',
      ],
    },
    targetDatabase: 'slotify_dev (read-only snapshot)',
    summary: {
      readyToImport: rows.filter(row => row.status === 'READY').length,
      needsReview: rows.filter(row => row.status === 'NEEDS_REVIEW').length,
      blocked: rows.filter(row => row.status === 'BLOCKED').length,
      totalSourceRows: rows.length,
    },
    masterDataSnapshot: masterData,
    rows,
  };
}

function markdownCell(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

export function formatWorkloadImportPreviewMarkdown(preview: WorkloadImportPreview): string {
  const rows = preview.rows.map(row => {
    const subjects = row.subjects
      .filter(subject => subject.rawLabel || subject.weeklyHours !== null)
      .map(subject => `${subject.rawLabel ?? 'Unlabeled'} / ${subject.weeklyHours ?? 'unreadable'}h`)
      .join('<br>') || '—';
    const subjectMatches = row.subjectMatches.map(({ rawLabel, candidates }) => {
      const possible = candidates.map(candidate => `${candidate.course_code ?? '(no code)'} ${candidate.course_name} (${candidate.match})`);
      return `${rawLabel}: ${possible.join(', ') || 'no catalogue candidate'}`;
    }).join('<br>') || '—';
    const facultyMatches = row.possibleFacultyMatches.map(candidate => `${candidate.name} (${candidate.staff_code ?? 'no staff code'}, id ${candidate.faculty_id})`).join('<br>') || 'None';
    const unresolved = row.unresolvedFields.join(', ') || '—';
    const issues = row.issues.map(item => `${item.severity} ${item.code}: ${item.message}`).join('<br>') || '—';
    const load = `${row.printedLoadSourceText} (parsed: ${[row.printedLoad.theoryHours, row.printedLoad.labHours, row.printedLoad.totalHours]
      .map(value => value ?? 'unreadable').join(' / ')})`;
    return `| ${row.rowNumber} | ${row.status} | ${row.facultyCategory} | ${markdownCell(row.sourceName ?? 'Missing source row')} | ${markdownCell(subjects)} | ${markdownCell(row.labDuty.rawLabel ? `${row.labDuty.rawLabel} / ${row.labDuty.weeklyHours ?? 'unreadable'}h` : '—')} | ${load} | ${markdownCell(facultyMatches)} | ${markdownCell(subjectMatches)} | ${markdownCell(unresolved)} | ${markdownCell(issues)} |`;
  });
  const departments = preview.masterDataSnapshot.departments
    .map(item => `${item.dept_id}: ${item.dept_code} — ${item.dept_name}${item.is_active ? '' : ' (inactive)'}`)
    .join('; ') || 'None';
  const terms = preview.masterDataSnapshot.terms
    .map(item => `${item.term_id}: ${item.term_name} (${item.year_label}, ${item.parity}, ${item.status})`)
    .join('; ') || 'None';
  const courses = preview.masterDataSnapshot.courses
    .map(item => `${item.course_code ?? '(no code)'} ${item.course_name}${item.is_active ? '' : ' (inactive)'}`)
    .join('; ') || 'None';
  const snapshot = preview.masterDataSnapshot;

  return [
    '# CSE workload import preview — Even Semester 2026',
    '',
    `Generated: ${preview.generatedAt}`,
    '',
    `**PREVIEW ONLY.** This report is not an import approval. No institutional records or assignments were changed. Database reads used a read-only transaction against ${preview.targetDatabase}.`,
    '',
    `- Ready to import: **${preview.summary.readyToImport}**`,
    `- Needs review: **${preview.summary.needsReview}**`,
    `- Blocked: **${preview.summary.blocked}**`,
    `- Source rows, including missing serial 38: **${preview.summary.totalSourceRows}**`,
    '',
    '## Existing master-data candidates (not selected or merged)',
    '',
    `- Departments: ${markdownCell(departments)}`,
    `- Faculty profiles: ${snapshot.faculty.map(item => `${item.faculty_id}: ${item.name} (${item.staff_code ?? 'no staff code'})`).join('; ') || 'None'}`,
    `- Term candidates: ${markdownCell(terms)}`,
    `- Active/inactive catalogue snapshot: ${markdownCell(courses)}`,
    `- Semesters: ${snapshot.semesters.length}; sections: ${snapshot.sections.length}; batches: ${snapshot.batches.length}; existing assignments: ${snapshot.assignments.length}.`,
    '- Prefix/acronym course matches are suggestions only; they do not verify canonical course identity.',
    '',
    '## Row-by-row preview',
    '',
    '| Row | Status | Faculty category | Source faculty | Subject labels / hours | Lab duty / hours | Printed theory / lab / total | Possible faculty matches | Possible catalogue matches | Unresolved source fields | Validation issues |',
    '|---:|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    '## College decisions required before any import',
    '',
    '- Confirm the authoritative CSE department record and the row-by-row identities using an official roster or unique staff codes.',
    '- Identify the two different guest faculty in rows 27–28; do not combine them based on the identical generic label.',
    '- Confirm whether rows 31 and 39 are the same Suchitra; resolve incomplete names and row 25’s “New Staff (Ms. Seema K)” identity.',
    '- Supply or confirm the missing serial row 38, or explicitly confirm it is intentionally absent.',
    '- Confirm canonical course code/name and component type for every abbreviation and distinguish courses from lab duties, mini-project, SDP, and coordination work.',
    '- Confirm term dates, curriculum scheme, semester, section, and any lab/tutorial batches for the sheet and each teaching row.',
    '- Resolve row 25’s joining date and handwritten hours/subtotal; clarify whether rows 29–36 intentionally omit theory/lab subtotals. Row 29 subject hours sum to 22 while printed total is 24.',
    '- Confirm workload counting rules for labs, TA work, SDP, minor projects, coordination, and project evaluation. Do not infer totals by double-counting categories.',
    '- Review the suggested existing course candidates and decide whether any identity/catalogue updates are explicitly authorized.',
    '',
    'The generated JSON contains the complete read-only master-data snapshot and machine-readable issues. Re-run `npm run preview:workload-import` from `backend` to refresh both preview files.',
    '',
  ].join('\n');
}
