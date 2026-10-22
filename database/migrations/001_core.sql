-- Slotify migration 001: identity, academic structure, courses, rooms/time,
-- faculty submissions/availability/workload, provenance.
-- Source of truth for the schema. data_status values: VERIFIED, VERIFY, DISCREPANCY, RESOLVED, SYNTHETIC.

CREATE TABLE users (
  user_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(150) NOT NULL,
  status ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
  failed_login_count INT NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE user_roles (
  user_role_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('ADMIN','FACULTY','STUDENT','COORDINATOR') NOT NULL,
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_role (user_id, role),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Configurable permission matrix (added; see docs/DEVIATIONS.md). COORDINATOR rows are provisional.
CREATE TABLE role_permissions (
  role ENUM('ADMIN','FACULTY','STUDENT','COORDINATOR') NOT NULL,
  permission VARCHAR(60) NOT NULL,
  is_provisional TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (role, permission)
) ENGINE=InnoDB;

-- Server-side refresh sessions (hashed opaque tokens, rotated on use).
CREATE TABLE refresh_sessions (
  session_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_refresh_token (token_hash),
  KEY ix_refresh_user (user_id),
  CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE departments (
  dept_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dept_code VARCHAR(20) NOT NULL,
  dept_name VARCHAR(150) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_dept_code (dept_code)
) ENGINE=InnoDB;

-- Added: designation lookup. Never inferred from names/titles.
CREATE TABLE designations (
  designation_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  designation_code VARCHAR(40) NOT NULL,
  designation_name VARCHAR(100) NOT NULL,
  data_status ENUM('VERIFIED','VERIFY','DISCREPANCY','RESOLVED','SYNTHETIC') NOT NULL DEFAULT 'VERIFY',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_designation_code (designation_code)
) ENGINE=InnoDB;

-- user_id, designation, staff_code, dept are nullable: absent from the workbook, never fabricated.
CREATE TABLE faculty_profiles (
  faculty_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  staff_code VARCHAR(40) NULL,
  name VARCHAR(150) NOT NULL,
  designation_id INT UNSIGNED NULL,
  dept_id INT UNSIGNED NULL,
  employment_type ENUM('REGULAR','GUEST','PART_TIME','TA') NULL,
  phone VARCHAR(30) NULL,
  email VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  data_status ENUM('VERIFIED','VERIFY','DISCREPANCY','RESOLVED','SYNTHETIC') NOT NULL DEFAULT 'VERIFY',
  UNIQUE KEY uq_faculty_user (user_id),
  UNIQUE KEY uq_faculty_staff_code (staff_code),
  CONSTRAINT fk_faculty_user FOREIGN KEY (user_id) REFERENCES users(user_id),
  CONSTRAINT fk_faculty_designation FOREIGN KEY (designation_id) REFERENCES designations(designation_id),
  CONSTRAINT fk_faculty_dept FOREIGN KEY (dept_id) REFERENCES departments(dept_id)
) ENGINE=InnoDB;

CREATE TABLE academic_years (
  year_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  year_label VARCHAR(20) NOT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_year_label (year_label),
  CONSTRAINT ck_year_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
) ENGINE=InnoDB;

CREATE TABLE terms (
  term_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  year_id INT UNSIGNED NOT NULL,
  term_name VARCHAR(60) NOT NULL,
  parity ENUM('ODD','EVEN') NOT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  status ENUM('DRAFT','ACTIVE','CLOSED') NOT NULL DEFAULT 'DRAFT',
  UNIQUE KEY uq_term_name (year_id, term_name),
  CONSTRAINT fk_terms_year FOREIGN KEY (year_id) REFERENCES academic_years(year_id),
  CONSTRAINT ck_term_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
) ENGINE=InnoDB;

CREATE TABLE programs (
  program_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dept_id INT UNSIGNED NOT NULL,
  program_code VARCHAR(30) NOT NULL,
  program_name VARCHAR(150) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_program (dept_id, program_code),
  CONSTRAINT fk_programs_dept FOREIGN KEY (dept_id) REFERENCES departments(dept_id)
) ENGINE=InnoDB;

CREATE TABLE curriculum_schemes (
  scheme_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  program_id INT UNSIGNED NOT NULL,
  scheme_code VARCHAR(30) NOT NULL,
  version VARCHAR(20) NOT NULL DEFAULT '1',
  effective_from DATE NULL,
  effective_to DATE NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_scheme (program_id, scheme_code, version),
  CONSTRAINT fk_scheme_program FOREIGN KEY (program_id) REFERENCES programs(program_id)
) ENGINE=InnoDB;

CREATE TABLE semesters (
  semester_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scheme_id INT UNSIGNED NOT NULL,
  semester_no TINYINT UNSIGNED NOT NULL,
  name VARCHAR(40) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_semester_no (scheme_id, semester_no),
  UNIQUE KEY uq_semester_scheme (semester_id, scheme_id),
  CONSTRAINT fk_semesters_scheme FOREIGN KEY (scheme_id) REFERENCES curriculum_schemes(scheme_id),
  CONSTRAINT ck_semester_no CHECK (semester_no BETWEEN 1 AND 12)
) ENGINE=InnoDB;

CREATE TABLE sections (
  section_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  term_id INT UNSIGNED NOT NULL,
  scheme_id INT UNSIGNED NOT NULL,
  semester_id INT UNSIGNED NOT NULL,
  section_name VARCHAR(20) NOT NULL,
  strength INT UNSIGNED NULL,
  data_status ENUM('VERIFIED','VERIFY','DISCREPANCY','RESOLVED','SYNTHETIC') NOT NULL DEFAULT 'VERIFY',
  UNIQUE KEY uq_section_name (term_id, semester_id, section_name),
  UNIQUE KEY uq_section_term (section_id, term_id),
  CONSTRAINT fk_sections_term FOREIGN KEY (term_id) REFERENCES terms(term_id),
  CONSTRAINT fk_sections_semester FOREIGN KEY (semester_id, scheme_id) REFERENCES semesters(semester_id, scheme_id)
) ENGINE=InnoDB;

CREATE TABLE batches (
  batch_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  section_id INT UNSIGNED NOT NULL,
  batch_name VARCHAR(30) NOT NULL,
  batch_type ENUM('LAB','TUTORIAL','ELECTIVE','OTHER') NOT NULL DEFAULT 'LAB',
  strength INT UNSIGNED NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_batch_name (section_id, batch_name),
  UNIQUE KEY uq_batch_section (batch_id, section_id),
  CONSTRAINT fk_batches_section FOREIGN KEY (section_id) REFERENCES sections(section_id)
) ENGINE=InnoDB;

CREATE TABLE room_types (
  room_type_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  type_code VARCHAR(30) NOT NULL,
  type_name VARCHAR(80) NOT NULL,
  description VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_room_type_code (type_code)
) ENGINE=InnoDB;

CREATE TABLE rooms (
  room_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  room_code VARCHAR(30) NOT NULL,
  room_name VARCHAR(100) NULL,
  room_type_id INT UNSIGNED NOT NULL,
  capacity INT UNSIGNED NULL,
  equipment VARCHAR(255) NULL,
  data_status ENUM('VERIFIED','VERIFY','DISCREPANCY','RESOLVED','SYNTHETIC') NOT NULL DEFAULT 'VERIFY',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_room_code (room_code),
  CONSTRAINT fk_rooms_type FOREIGN KEY (room_type_id) REFERENCES room_types(room_type_id),
  CONSTRAINT ck_room_capacity CHECK (capacity IS NULL OR capacity > 0)
) ENGINE=InnoDB;

-- course_code is nullable and NOT unique (course-code uniqueness policy is unresolved: decision S).
CREATE TABLE courses (
  course_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dept_id INT UNSIGNED NULL,
  course_code VARCHAR(30) NULL,
  course_name VARCHAR(200) NOT NULL,
  credits DECIMAL(3,1) NULL,
  category VARCHAR(20) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  data_status ENUM('VERIFIED','VERIFY','DISCREPANCY','RESOLVED','SYNTHETIC') NOT NULL DEFAULT 'VERIFY',
  KEY ix_course_code (course_code),
  CONSTRAINT fk_courses_dept FOREIGN KEY (dept_id) REFERENCES departments(dept_id)
) ENGINE=InnoDB;

CREATE TABLE course_components (
  component_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  course_id INT UNSIGNED NOT NULL,
  component_type ENUM('THEORY','TUTORIAL','LAB','PROJECT') NOT NULL,
  weekly_hours DECIMAL(4,2) NULL,
  periods_per_session TINYINT UNSIGNED NULL,
  is_consecutive TINYINT(1) NOT NULL DEFAULT 0,
  required_room_type_id INT UNSIGNED NULL,
  data_status ENUM('VERIFIED','VERIFY','DISCREPANCY','RESOLVED','SYNTHETIC') NOT NULL DEFAULT 'VERIFY',
  UNIQUE KEY uq_component_type (course_id, component_type),
  UNIQUE KEY uq_component_course (component_id, course_id),
  CONSTRAINT fk_components_course FOREIGN KEY (course_id) REFERENCES courses(course_id),
  CONSTRAINT fk_components_roomtype FOREIGN KEY (required_room_type_id) REFERENCES room_types(room_type_id),
  CONSTRAINT ck_component_hours CHECK (weekly_hours IS NULL OR weekly_hours >= 0),
  CONSTRAINT ck_component_periods CHECK (periods_per_session IS NULL OR periods_per_session >= 1)
) ENGINE=InnoDB;

-- group_id has no FK on purpose: curriculum is term-independent but elective_groups are per term (open issue, docs/DEVIATIONS.md).
CREATE TABLE curriculum_courses (
  curriculum_course_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scheme_id INT UNSIGNED NOT NULL,
  semester_id INT UNSIGNED NOT NULL,
  course_id INT UNSIGNED NOT NULL,
  is_elective TINYINT(1) NOT NULL DEFAULT 0,
  group_id INT UNSIGNED NULL,
  UNIQUE KEY uq_curriculum_course (semester_id, course_id),
  CONSTRAINT fk_cc_semester FOREIGN KEY (semester_id, scheme_id) REFERENCES semesters(semester_id, scheme_id),
  CONSTRAINT fk_cc_course FOREIGN KEY (course_id) REFERENCES courses(course_id)
) ENGINE=InnoDB;

CREATE TABLE course_offerings (
  offering_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  component_id INT UNSIGNED NOT NULL,
  term_id INT UNSIGNED NOT NULL,
  offering_code VARCHAR(40) NULL,
  pattern_type ENUM('WEEKLY','IRREGULAR','CUSTOM') NOT NULL DEFAULT 'WEEKLY',
  status ENUM('DRAFT','OFFERED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  data_status ENUM('VERIFIED','VERIFY','DISCREPANCY','RESOLVED','SYNTHETIC') NOT NULL DEFAULT 'VERIFY',
  UNIQUE KEY uq_offering_term (offering_id, term_id),
  KEY ix_offering_component (component_id, term_id),
  CONSTRAINT fk_offerings_component FOREIGN KEY (component_id) REFERENCES course_components(component_id),
  CONSTRAINT fk_offerings_term FOREIGN KEY (term_id) REFERENCES terms(term_id)
) ENGINE=InnoDB;

CREATE TABLE offering_audiences (
  audience_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  offering_id INT UNSIGNED NOT NULL,
  term_id INT UNSIGNED NOT NULL,
  section_id INT UNSIGNED NOT NULL,
  batch_id INT UNSIGNED NULL,
  batch_key INT UNSIGNED GENERATED ALWAYS AS (IFNULL(batch_id, 0)) STORED,
  strength INT UNSIGNED NULL,
  data_status ENUM('VERIFIED','VERIFY','DISCREPANCY','RESOLVED','SYNTHETIC') NOT NULL DEFAULT 'VERIFY',
  UNIQUE KEY uq_audience (offering_id, section_id, batch_key),
  CONSTRAINT fk_aud_offering FOREIGN KEY (offering_id, term_id) REFERENCES course_offerings(offering_id, term_id),
  CONSTRAINT fk_aud_section FOREIGN KEY (section_id, term_id) REFERENCES sections(section_id, term_id),
  CONSTRAINT fk_aud_batch FOREIGN KEY (batch_id, section_id) REFERENCES batches(batch_id, section_id)
) ENGINE=InnoDB;

-- One submission per faculty per term; groups preferences + availability (approved design).
CREATE TABLE faculty_submissions (
  submission_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  faculty_id BIGINT UNSIGNED NOT NULL,
  term_id INT UNSIGNED NOT NULL,
  submission_status ENUM('NOT_STARTED','DRAFT','SUBMITTED','RETURNED') NOT NULL DEFAULT 'NOT_STARTED',
  submitted_at DATETIME NULL,
  review_status ENUM('PENDING','IN_REVIEW','ACCEPTED','CHANGES_REQUESTED') NOT NULL DEFAULT 'PENDING',
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  review_comment TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_submission_faculty_term (faculty_id, term_id),
  UNIQUE KEY uq_submission_term (submission_id, term_id),
  UNIQUE KEY uq_submission_faculty (submission_id, faculty_id),
  CONSTRAINT fk_sub_faculty FOREIGN KEY (faculty_id) REFERENCES faculty_profiles(faculty_id),
  CONSTRAINT fk_sub_term FOREIGN KEY (term_id) REFERENCES terms(term_id),
  CONSTRAINT fk_sub_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(user_id),
  CONSTRAINT ck_sub_submitted CHECK (submission_status <> 'SUBMITTED' OR submitted_at IS NOT NULL)
) ENGINE=InnoDB;

-- Max three preferences is structural: preference_order is limited to 1..3 and unique per submission.
-- A preference is a request only; it never creates an assignment.
CREATE TABLE faculty_subject_preferences (
  preference_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  submission_id BIGINT UNSIGNED NOT NULL,
  preference_order TINYINT UNSIGNED NOT NULL,
  course_id INT UNSIGNED NOT NULL,
  component_id INT UNSIGNED NULL,
  component_key INT UNSIGNED GENERATED ALWAYS AS (IFNULL(component_id, 0)) STORED,
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pref_order (submission_id, preference_order),
  UNIQUE KEY uq_pref_target (submission_id, course_id, component_key),
  CONSTRAINT fk_pref_submission FOREIGN KEY (submission_id) REFERENCES faculty_submissions(submission_id) ON DELETE CASCADE,
  CONSTRAINT fk_pref_course FOREIGN KEY (course_id) REFERENCES courses(course_id),
  CONSTRAINT fk_pref_component FOREIGN KEY (component_id, course_id) REFERENCES course_components(component_id, course_id),
  CONSTRAINT ck_pref_order CHECK (preference_order BETWEEN 1 AND 3)
) ENGINE=InnoDB;

-- Final assignments are separate from preferences. Approval tracking model (decision D) is unresolved:
-- the diagram's is_approved/approved_by/approved_at are kept as-is.
CREATE TABLE faculty_assignments (
  assignment_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  audience_id INT UNSIGNED NOT NULL,
  faculty_id BIGINT UNSIGNED NOT NULL,
  role ENUM('UNSPECIFIED','LECTURER','LAB_LEAD','LAB_ASSISTANT','TUTOR') NOT NULL DEFAULT 'UNSPECIFIED',
  role_status ENUM('VERIFIED','VERIFY','DISCREPANCY','RESOLVED','SYNTHETIC') NOT NULL DEFAULT 'VERIFY',
  source_preference_id BIGINT UNSIGNED NULL,
  is_approved TINYINT(1) NOT NULL DEFAULT 0,
  approved_by BIGINT UNSIGNED NULL,
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_assignment (audience_id, faculty_id, role),
  CONSTRAINT fk_fa_audience FOREIGN KEY (audience_id) REFERENCES offering_audiences(audience_id),
  CONSTRAINT fk_fa_faculty FOREIGN KEY (faculty_id) REFERENCES faculty_profiles(faculty_id),
  CONSTRAINT fk_fa_pref FOREIGN KEY (source_preference_id) REFERENCES faculty_subject_preferences(preference_id) ON DELETE SET NULL,
  CONSTRAINT fk_fa_approver FOREIGN KEY (approved_by) REFERENCES users(user_id),
  CONSTRAINT ck_fa_approved CHECK (is_approved = 0 OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
) ENGINE=InnoDB;

CREATE TABLE elective_groups (
  elective_group_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  term_id INT UNSIGNED NOT NULL,
  group_name VARCHAR(80) NOT NULL,
  requires_parallel_slots TINYINT(1) NOT NULL DEFAULT 0,
  allow_combined_faculty TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_egroup_name (term_id, group_name),
  UNIQUE KEY uq_egroup_term (elective_group_id, term_id),
  CONSTRAINT fk_egroup_term FOREIGN KEY (term_id) REFERENCES terms(term_id)
) ENGINE=InnoDB;

CREATE TABLE elective_group_offerings (
  group_offering_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  elective_group_id INT UNSIGNED NOT NULL,
  offering_id INT UNSIGNED NOT NULL,
  term_id INT UNSIGNED NOT NULL,
  UNIQUE KEY uq_ego (elective_group_id, offering_id),
  CONSTRAINT fk_ego_group FOREIGN KEY (elective_group_id, term_id) REFERENCES elective_groups(elective_group_id, term_id),
  CONSTRAINT fk_ego_offering FOREIGN KEY (offering_id, term_id) REFERENCES course_offerings(offering_id, term_id)
) ENGINE=InnoDB;

CREATE TABLE term_teaching_days (
  term_day_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  term_id INT UNSIGNED NOT NULL,
  day_name ENUM('MON','TUE','WED','THU','FRI','SAT','SUN') NOT NULL,
  is_teaching_day TINYINT(1) NOT NULL DEFAULT 1,
  closing_time TIME NULL,
  UNIQUE KEY uq_term_day (term_id, day_name),
  UNIQUE KEY uq_term_day_term (term_day_id, term_id),
  CONSTRAINT fk_ttd_term FOREIGN KEY (term_id) REFERENCES terms(term_id)
) ENGINE=InnoDB;

CREATE TABLE time_slots (
  slot_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  term_id INT UNSIGNED NOT NULL,
  slot_no TINYINT UNSIGNED NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_type ENUM('TEACHING','BREAK','LUNCH') NOT NULL DEFAULT 'TEACHING',
  data_status ENUM('VERIFIED','VERIFY','DISCREPANCY','RESOLVED','SYNTHETIC') NOT NULL DEFAULT 'VERIFY',
  UNIQUE KEY uq_slot_no (term_id, slot_no),
  UNIQUE KEY uq_slot_term (slot_id, term_id),
  CONSTRAINT fk_slots_term FOREIGN KEY (term_id) REFERENCES terms(term_id),
  CONSTRAINT ck_slot_time CHECK (end_time > start_time)
) ENGINE=InnoDB;

CREATE TABLE term_day_slots (
  term_day_slot_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  term_id INT UNSIGNED NOT NULL,
  term_day_id INT UNSIGNED NOT NULL,
  slot_id INT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_tds (term_day_id, slot_id),
  CONSTRAINT fk_tds_day FOREIGN KEY (term_day_id, term_id) REFERENCES term_teaching_days(term_day_id, term_id),
  CONSTRAINT fk_tds_slot FOREIGN KEY (slot_id, term_id) REFERENCES time_slots(slot_id, term_id)
) ENGINE=InnoDB;

CREATE TABLE room_availability (
  room_availability_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  room_id INT UNSIGNED NOT NULL,
  term_id INT UNSIGNED NOT NULL,
  `day` ENUM('MON','TUE','WED','THU','FRI','SAT','SUN') NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  availability_type ENUM('AVAILABLE','UNAVAILABLE','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  data_status ENUM('VERIFIED','VERIFY','DISCREPANCY','RESOLVED','SYNTHETIC') NOT NULL DEFAULT 'VERIFY',
  UNIQUE KEY uq_room_avail (room_id, term_id, `day`, start_time, end_time),
  CONSTRAINT fk_ra_room FOREIGN KEY (room_id) REFERENCES rooms(room_id),
  CONSTRAINT fk_ra_term FOREIGN KEY (term_id) REFERENCES terms(term_id),
  CONSTRAINT ck_ra_time CHECK (end_time > start_time)
) ENGINE=InnoDB;

-- Explicit AVAILABLE / UNAVAILABLE / UNKNOWN. No row means "unknown", never "unrestricted" (decision H).
CREATE TABLE faculty_availability (
  faculty_availability_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  faculty_id BIGINT UNSIGNED NOT NULL,
  term_id INT UNSIGNED NOT NULL,
  submission_id BIGINT UNSIGNED NULL,
  source ENUM('FACULTY_SUBMISSION','ADMIN_ENTRY','WORKBOOK') NOT NULL,
  `day` ENUM('MON','TUE','WED','THU','FRI','SAT','SUN') NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  availability_type ENUM('AVAILABLE','UNAVAILABLE','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  data_status ENUM('VERIFIED','VERIFY','DISCREPANCY','RESOLVED','SYNTHETIC') NOT NULL DEFAULT 'VERIFY',
  UNIQUE KEY uq_fac_avail (faculty_id, term_id, `day`, start_time, end_time),
  CONSTRAINT fk_fav_faculty FOREIGN KEY (faculty_id) REFERENCES faculty_profiles(faculty_id),
  CONSTRAINT fk_fav_term FOREIGN KEY (term_id) REFERENCES terms(term_id),
  CONSTRAINT fk_fav_sub_term FOREIGN KEY (submission_id, term_id) REFERENCES faculty_submissions(submission_id, term_id),
  CONSTRAINT fk_fav_sub_faculty FOREIGN KEY (submission_id, faculty_id) REFERENCES faculty_submissions(submission_id, faculty_id),
  CONSTRAINT ck_fav_time CHECK (end_time > start_time),
  CONSTRAINT ck_fav_source CHECK (source <> 'FACULTY_SUBMISSION' OR submission_id IS NOT NULL)
) ENGINE=InnoDB;

CREATE TABLE faculty_workload_rules (
  workload_rule_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  designation_id INT UNSIGNED NOT NULL,
  max_hours DECIMAL(4,1) NOT NULL,
  enforcement_mode ENUM('HARD','WARNING') NOT NULL DEFAULT 'HARD',
  effective_from DATE NULL,
  effective_to DATE NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  data_status ENUM('VERIFIED','VERIFY','DISCREPANCY','RESOLVED','SYNTHETIC') NOT NULL DEFAULT 'VERIFY',
  KEY ix_wr_designation (designation_id, is_active),
  CONSTRAINT fk_wr_designation FOREIGN KEY (designation_id) REFERENCES designations(designation_id),
  CONSTRAINT ck_wr_hours CHECK (max_hours > 0),
  CONSTRAINT ck_wr_dates CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
) ENGINE=InnoDB;

-- Counting rules for non-theory/lab activities stay UNCONFIRMED until the university confirms them.
CREATE TABLE workload_counting_policy (
  activity_type ENUM('LAB_ASSISTANT','PROJECT_SUPERVISION','SDP','MINOR_PROJECT') NOT NULL PRIMARY KEY,
  counts_toward_limit ENUM('YES','NO','UNCONFIRMED') NOT NULL DEFAULT 'UNCONFIRMED',
  notes VARCHAR(255) NULL
) ENGINE=InnoDB;

CREATE TABLE source_documents (
  document_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  file_name VARCHAR(255) NOT NULL,
  source_type VARCHAR(60) NOT NULL,
  form_no VARCHAR(40) NULL,
  revision VARCHAR(20) NULL,
  term_id INT UNSIGNED NULL,
  uploaded_by BIGINT UNSIGNED NULL,
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  remarks TEXT NULL,
  CONSTRAINT fk_sd_term FOREIGN KEY (term_id) REFERENCES terms(term_id),
  CONSTRAINT fk_sd_user FOREIGN KEY (uploaded_by) REFERENCES users(user_id)
) ENGINE=InnoDB;

CREATE TABLE data_provenance (
  provenance_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_id BIGINT UNSIGNED NOT NULL,
  table_name VARCHAR(64) NOT NULL,
  record_id BIGINT UNSIGNED NOT NULL,
  field_name VARCHAR(64) NULL,
  source_page VARCHAR(20) NULL,
  source_row VARCHAR(40) NULL,
  source_value TEXT NULL,
  normalized_value TEXT NULL,
  data_status ENUM('VERIFIED','VERIFY','DISCREPANCY','RESOLVED','SYNTHETIC') NOT NULL DEFAULT 'VERIFY',
  verified_by BIGINT UNSIGNED NULL,
  verified_at DATETIME NULL,
  resolution_notes TEXT NULL,
  KEY ix_prov_record (table_name, record_id),
  CONSTRAINT fk_prov_doc FOREIGN KEY (document_id) REFERENCES source_documents(document_id),
  CONSTRAINT fk_prov_user FOREIGN KEY (verified_by) REFERENCES users(user_id)
) ENGINE=InnoDB;

CREATE TABLE discrepancy_log (
  discrepancy_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_id BIGINT UNSIGNED NULL,
  table_name VARCHAR(64) NOT NULL,
  record_id BIGINT UNSIGNED NULL,
  field_name VARCHAR(64) NOT NULL,
  source_value TEXT NULL,
  conflicting_value TEXT NULL,
  resolved_value TEXT NULL,
  status ENUM('OPEN','RESOLVED','WONT_FIX') NOT NULL DEFAULT 'OPEN',
  resolved_by BIGINT UNSIGNED NULL,
  resolved_at DATETIME NULL,
  remarks TEXT NULL,
  CONSTRAINT fk_dl_doc FOREIGN KEY (document_id) REFERENCES source_documents(document_id),
  CONSTRAINT fk_dl_user FOREIGN KEY (resolved_by) REFERENCES users(user_id),
  CONSTRAINT ck_dl_resolved CHECK (status <> 'RESOLVED' OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL))
) ENGINE=InnoDB;
