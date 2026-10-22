// ---------------------------------------------------------------------------
// Auth / Users
// ---------------------------------------------------------------------------
export type Role = 'ADMIN' | 'FACULTY' | 'STUDENT' | 'COORDINATOR';

export interface AuthUser {
  userId: number;
  username: string;
  name: string;
  roles: Role[];
}

export interface User {
  userId: number;
  username: string;
  email: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
  roles: Role[];
}

// ---------------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------------
export interface Department {
  dept_id: number;
  dept_code: string;
  dept_name: string;
  is_active: number;
}

export interface Designation {
  designation_id: number;
  designation_code: string;
  designation_name: string;
  data_status: string;
  is_active: number;
}

export interface FacultyProfile {
  faculty_id: number;
  user_id: number | null;
  staff_code: string | null;
  name: string;
  designation_id: number | null;
  designation_name?: string;
  dept_id: number | null;
  dept_name?: string;
  employment_type: string | null;
  phone: string | null;
  email: string | null;
  is_active: number;
  data_status: string;
}

export interface AcademicYear {
  year_id: number;
  year_label: string;
  start_date: string | null;
  end_date: string | null;
  is_active: number;
}

export interface Term {
  term_id: number;
  year_id: number;
  term_name: string;
  parity: 'ODD' | 'EVEN';
  start_date: string | null;
  end_date: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED';
}

export interface Program {
  program_id: number;
  dept_id: number;
  program_code: string;
  program_name: string;
  is_active: number;
}

export interface Scheme {
  scheme_id: number;
  program_id: number;
  scheme_code: string;
  version: string;
  is_active: number;
}

export interface Semester {
  semester_id: number;
  scheme_id: number;
  semester_no: number;
  name: string | null;
  is_active: number;
}

export interface Section {
  section_id: number;
  term_id: number;
  scheme_id: number;
  semester_id: number;
  section_name: string;
  strength: number | null;
  is_active: number;
  data_status: string;
}

export interface TermProgramSemester {
  term_program_semester_id: number;
  term_id: number;
  scheme_id: number;
  semester_id: number;
  is_active: number;
}

export interface Batch {
  batch_id: number;
  section_id: number;
  batch_name: string;
  batch_type: 'LAB' | 'TUTORIAL' | 'ELECTIVE' | 'OTHER';
  strength: number | null;
  is_active: number;
}

export interface RoomType {
  room_type_id: number;
  type_code: string;
  type_name: string;
  description: string | null;
  is_active: number;
}

export interface Room {
  room_id: number;
  room_code: string;
  room_name: string | null;
  room_type_id: number;
  capacity: number | null;
  equipment: string | null;
  practical_approved: number;
  location: string | null;
  is_active: number;
  data_status: string;
}

export interface RoomAvailability {
  room_availability_id: number;
  room_id: number;
  term_id: number;
  day: string;
  start_time: string;
  end_time: string;
  availability_type: AvailabilityType;
  data_status: string;
}

export interface Course {
  course_id: number;
  dept_id: number | null;
  course_code: string | null;
  course_name: string;
  credits: number | null;
  category: string | null;
  is_active: number;
  data_status: string;
}

export interface CourseComponent {
  component_id: number;
  course_id: number;
  component_type: 'THEORY' | 'TUTORIAL' | 'LAB' | 'PROJECT';
  weekly_hours: number | null;
  periods_per_session: number | null;
  is_consecutive: number;
  required_room_type_id: number | null;
  data_status: string;
}

export interface CurriculumCourse {
  curriculum_course_id: number;
  scheme_id: number;
  semester_id: number;
  course_id: number;
  is_elective: number;
  group_id: number | null;
}

export interface CourseOffering {
  offering_id: number;
  component_id: number;
  term_id: number;
  offering_code: string | null;
  pattern_type: string;
  status: 'DRAFT' | 'OFFERED' | 'CANCELLED';
  data_status: string;
}

export interface TimeSlot {
  slot_id: number;
  term_id: number;
  slot_no: number;
  start_time: string;
  end_time: string;
  slot_type: 'TEACHING' | 'BREAK' | 'LUNCH';
  data_status: string;
}

export interface TeachingDay {
  term_day_id: number;
  term_id: number;
  day_name: string;
  is_teaching_day: number;
  closing_time: string | null;
}

// ---------------------------------------------------------------------------
// Assignments & Workload
// ---------------------------------------------------------------------------
export type AssignmentRole = 'UNSPECIFIED' | 'LECTURER' | 'LAB_LEAD' | 'LAB_ASSISTANT' | 'TUTOR';

export interface Assignment {
  assignment_id: number;
  audience_id: number;
  faculty_id: number;
  faculty_name: string;
  role: AssignmentRole;
  role_status: string;
  source_preference_id: number | null;
  is_approved: number;
  approved_by: number | null;
  approved_at: string | null;
  created_at: string;
  term_id: number;
  component_type: string;
  course_name: string;
  course_code: string | null;
  // enriched fields (from GET /:id)
  designation_name?: string;
  section_id?: number;
  batch_id?: number | null;
  year_id?: number;
  year_label?: string;
  term_name?: string;
  parity?: 'ODD' | 'EVEN';
  section_name?: string;
  batch_name?: string | null;
  semester_id?: number;
  semester_no?: number;
  semester_name?: string | null;
  program_code?: string;
  program_name?: string;
}

export interface WorkloadResult {
  faculty_id: number;
  term_id: number;
  confirmed_hours: number;
  unconfirmed_hours: number;
  unconfirmed_activities: { role: string; activity_type: string; weekly_hours: number | null; counts_toward_limit: string }[];
  limit_status: 'OK' | 'OVER_LIMIT' | 'WARNING' | 'NO_RULE';
  max_hours?: number;
  enforcement_mode?: 'HARD' | 'WARNING';
  warning_message?: string;
}

export interface AllocationContextOption {
  term_id: number;
  term_name: string;
  term_status: string;
  parity: string;
  year_label: string;
  program_id: number;
  program_name: string;
  program_code: string;
  scheme_id: number;
  scheme_code: string;
  semester_id: number;
  semester_no: number;
  semester_name: string | null;
  section_id: number;
  section_name: string;
  strength: number | null;
}

export interface AllocationIssue {
  severity: 'ERROR' | 'WARNING';
  code: string;
  message: string;
  audience_id: number | null;
}

export interface AllocationAssignment {
  assignment_id: number;
  audience_id: number;
  faculty_id: number;
  faculty_name: string;
  role: AssignmentRole;
  role_status: string;
  source_preference_id: number | null;
  is_approved: number;
  created_at: string;
  staff_code: string | null;
  is_active: number;
  faculty_data_status: string;
  designation_name: string | null;
  availability_confirmed: boolean;
  accepted_preferences_exist: boolean;
  preference_rank: number | null;
}

export interface AllocationRequirement {
  course_id: number;
  course_name: string;
  course_code: string | null;
  component_id: number | null;
  component_type: string;
  weekly_hours: number | null;
  periods_per_session: number | null;
  is_consecutive: number;
  required_room_type: string | null;
  offering_id: number | null;
  offering_status: string | null;
  audience_id: number | null;
  section_id: number | null;
  batch_id: number | null;
  batch_is_active: number | null;
  batch_name: string | null;
  strength: number | null;
  data_status: string;
  accepted_preference_count: number;
  preferred_faculty: { faculty_id: number; preference_rank: number; preference_id: number }[];
  assignments: AllocationAssignment[];
}

export interface AllocationFaculty {
  faculty_id: number;
  faculty_name: string;
  staff_code: string | null;
  designation_name: string | null;
  faculty_data_status: string;
  availability_confirmed: boolean;
  accepted_preferences_exist: boolean;
  confirmed_hours: number;
  draft_hours: number;
  assigned_hours: number;
  unconfirmed_hours: number;
  remaining_hours: number | null;
  overload_hours: number | null;
  limit_status: WorkloadResult['limit_status'];
  max_hours: number | null;
  enforcement_mode: WorkloadResult['enforcement_mode'] | null;
  workload_warning: string | null;
}

export interface AllocationPlan {
  context: AllocationContextOption;
  requirements: AllocationRequirement[];
  faculty: AllocationFaculty[];
  issues: AllocationIssue[];
  can_finalize: boolean;
  required_hours: number;
  allocated_hours: number;
  unallocated_hours: number;
}

// ---------------------------------------------------------------------------
// Faculty submissions
// ---------------------------------------------------------------------------
export type SubmissionStatus = 'NOT_STARTED' | 'DRAFT' | 'SUBMITTED' | 'RETURNED';
export type ReviewStatus = 'PENDING' | 'IN_REVIEW' | 'ACCEPTED' | 'CHANGES_REQUESTED';
export type AvailabilityType = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';

export interface FacultySubmission {
  submission_id: number;
  faculty_id: number;
  faculty_name?: string;
  term_id: number;
  submission_status: SubmissionStatus;
  submitted_at: string | null;
  review_status: ReviewStatus;
  reviewed_by: number | null;
  reviewer_name?: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
  created_at: string;
  updated_at: string;
}

export interface FacultyPreference {
  preference_id: number;
  preference_order: number;
  preference_kind?: 'COURSE' | 'SOURCE';
  course_id: number | null;
  semester_id?: number | null;
  course_name: string | null;
  course_code: string | null;
  component_id: number | null;
  component_type: string | null;
  weekly_hours?: number | null;
  program_id?: number | null;
  program_code?: string | null;
  program_name?: string | null;
  semester_no?: number | null;
  semester_name?: string | null;
  note: string | null;
  source_row_id?: number | null;
  source_subject_column?: string | null;
  source_page?: number | null;
  source_row_number?: number | null;
  source_label?: string | null;
  source_hours?: number | null;
}

export interface AvailableSourceSubject {
  source_row_id: number;
  source_row_number: number;
  source_page: number;
  source_column: string;
  source_label: string;
  weekly_hours: number | null;
  occurrences: number;
  verification_status: 'PENDING_ADMIN_VERIFICATION';
}

export interface FacultyAvailabilityWindow {
  faculty_availability_id: number;
  day: string;
  start_time: string;
  end_time: string;
  availability_type: AvailabilityType;
  source: string;
  data_status: string;
}

export interface SubmissionDetail {
  submission: FacultySubmission;
  preferences: FacultyPreference[];
  availability: FacultyAvailabilityWindow[];
  unrecordedAvailability: 'UNKNOWN';
}

/** Returned by GET /api/faculty-submissions/mine/available-courses */
export interface AvailableCourse {
  course_id: number;
  course_name: string;
  course_code: string | null;
  credits: number | null;
  category: string | null;
  dept_id: number | null;
  dept_name: string | null;
  programs: {
    program_id: number;
    program_name: string;
    program_code: string;
    semester_no: number;
    semester_name: string | null;
  }[];
  components: {
    component_id: number;
    component_type: string;
    weekly_hours: number | null;
    periods_per_session: number | null;
    is_consecutive: number;
    required_room_type: string | null;
    audience_count: number | null;
  }[];
}

/** Returned by GET /api/faculty-submissions/mine/track */
export interface FacultyTrack {
  term_id: number;
  faculty_id: number;
  submission: {
    submission: FacultySubmission;
    preferences: FacultyPreference[];
    availability: FacultyAvailabilityWindow[];
    unrecordedAvailability: 'UNKNOWN';
  } | null;
  assignments: TrackAssignment[];
  audit_trail: AuditEvent[];
}

export interface TrackAssignment {
  assignment_id: number;
  role: string;
  is_approved: number;
  approved_by: number | null;
  approved_at: string | null;
  created_at: string;
  source_preference_id: number | null;
  course_name: string;
  course_code: string | null;
  component_type: string;
  weekly_hours: number | null;
  section_name: string;
  batch_name: string | null;
  approved_by_name: string | null;
}

export interface AuditEvent {
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
  actor_name: string | null;
}

// ---------------------------------------------------------------------------
// Timetable
// ---------------------------------------------------------------------------
export type TimetableStatus = 'DRAFT' | 'VALIDATED' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'PUBLISHED' | 'ARCHIVED';

export interface TimetableVersion {
  version_id: number;
  term_id: number;
  version_no: number;
  status: TimetableStatus;
  availability_unknown_status: string;
  created_by: number;
  created_at: string;
  published_at: string | null;
}

export interface ValidationRun {
  validation_id: number;
  version_id: number;
  validation_type: string;
  status: 'RUNNING' | 'PASSED' | 'FAILED';
  started_at: string;
  ended_at: string | null;
}

export interface ValidationIssue {
  issue_id: number;
  validation_id: number;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  rule_code: string;
  message: string;
  details: Record<string, unknown>;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
}

export interface ScheduledSession {
  session_id: number;
  version_id: number;
  offering_id: number;
  room_id: number;
  day: string;
  start_time: string;
  end_time: string;
}
