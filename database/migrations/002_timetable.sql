-- Slotify migration 002: timetable generation, versions, sessions, validation, approvals.
-- Statements are separated by the marker line "-- @@" (see backend/src/db/migrate.ts).

CREATE TABLE timetable_versions (
  version_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  term_id INT UNSIGNED NOT NULL,
  version_no INT UNSIGNED NOT NULL,
  parent_version_id BIGINT UNSIGNED NULL,
  status ENUM('DRAFT','VALIDATED','IN_REVIEW','APPROVED','REJECTED','PUBLISHED','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  -- Decision H: runs allowed with unknown faculty availability carry this flag.
  availability_unknown_status ENUM('NONE','OPEN','RESOLVED','OVERRIDDEN') NOT NULL DEFAULT 'NONE',
  unknown_override_reason TEXT NULL,
  unknown_override_by BIGINT UNSIGNED NULL,
  unknown_override_at DATETIME NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at DATETIME NULL,
  published_flag TINYINT GENERATED ALWAYS AS (IF(status = 'PUBLISHED', 1, NULL)) STORED,
  UNIQUE KEY uq_version_no (term_id, version_no),
  UNIQUE KEY uq_version_term (version_id, term_id),
  UNIQUE KEY uq_one_published (term_id, published_flag),
  CONSTRAINT fk_tv_term FOREIGN KEY (term_id) REFERENCES terms(term_id),
  CONSTRAINT fk_tv_parent FOREIGN KEY (parent_version_id, term_id) REFERENCES timetable_versions(version_id, term_id),
  CONSTRAINT fk_tv_creator FOREIGN KEY (created_by) REFERENCES users(user_id),
  CONSTRAINT fk_tv_override_by FOREIGN KEY (unknown_override_by) REFERENCES users(user_id),
  CONSTRAINT ck_tv_published CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL),
  CONSTRAINT ck_tv_override CHECK (availability_unknown_status <> 'OVERRIDDEN'
      OR (unknown_override_reason IS NOT NULL AND unknown_override_by IS NOT NULL)),
  -- A version with open unknown availability cannot enter review, approval or publication.
  CONSTRAINT ck_tv_unknown_gate CHECK (NOT (availability_unknown_status = 'OPEN'
      AND status IN ('IN_REVIEW','APPROVED','PUBLISHED')))
) ENGINE=InnoDB;

-- @@

CREATE TABLE generation_runs (
  run_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  term_id INT UNSIGNED NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  run_type ENUM('GENERATE','VALIDATE_ONLY') NOT NULL DEFAULT 'GENERATE',
  status ENUM('QUEUED','RUNNING','SUCCEEDED','INFEASIBLE','FAILED','BLOCKED') NOT NULL DEFAULT 'QUEUED',
  settings_json JSON NULL,
  allow_unknown_availability TINYINT(1) NOT NULL DEFAULT 0,
  unknown_override_reason TEXT NULL,
  unknown_override_by BIGINT UNSIGNED NULL,
  started_at DATETIME NULL,
  ended_at DATETIME NULL,
  result_version_id BIGINT UNSIGNED NULL,
  remarks TEXT NULL,
  UNIQUE KEY uq_run_term (run_id, term_id),
  CONSTRAINT fk_gr_term FOREIGN KEY (term_id) REFERENCES terms(term_id),
  CONSTRAINT fk_gr_creator FOREIGN KEY (created_by) REFERENCES users(user_id),
  CONSTRAINT fk_gr_override_by FOREIGN KEY (unknown_override_by) REFERENCES users(user_id),
  CONSTRAINT fk_gr_version FOREIGN KEY (result_version_id, term_id) REFERENCES timetable_versions(version_id, term_id),
  -- Override requires a recorded reason and actor.
  CONSTRAINT ck_gr_override CHECK (allow_unknown_availability = 0
      OR (unknown_override_reason IS NOT NULL AND unknown_override_by IS NOT NULL))
) ENGINE=InnoDB;

-- @@

CREATE TABLE generation_run_sections (
  run_section_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_id BIGINT UNSIGNED NOT NULL,
  term_id INT UNSIGNED NOT NULL,
  section_id INT UNSIGNED NOT NULL,
  UNIQUE KEY uq_grs (run_id, section_id),
  CONSTRAINT fk_grs_run FOREIGN KEY (run_id, term_id) REFERENCES generation_runs(run_id, term_id),
  CONSTRAINT fk_grs_section FOREIGN KEY (section_id, term_id) REFERENCES sections(section_id, term_id)
) ENGINE=InnoDB;

-- @@

CREATE TABLE timetable_version_sections (
  version_section_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  version_id BIGINT UNSIGNED NOT NULL,
  term_id INT UNSIGNED NOT NULL,
  section_id INT UNSIGNED NOT NULL,
  UNIQUE KEY uq_tvs (version_id, section_id),
  CONSTRAINT fk_tvs_version FOREIGN KEY (version_id, term_id) REFERENCES timetable_versions(version_id, term_id),
  CONSTRAINT fk_tvs_section FOREIGN KEY (section_id, term_id) REFERENCES sections(section_id, term_id)
) ENGINE=InnoDB;

-- @@

-- Actual start/end times are stored (slot ids/count are optional helpers), so irregular and
-- fractional-duration sessions can be represented. session_date is for non-weekly sessions.
-- Room/faculty/audience overlap is checked by the backend validator (interval logic).
CREATE TABLE scheduled_sessions (
  session_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  version_id BIGINT UNSIGNED NOT NULL,
  term_id INT UNSIGNED NOT NULL,
  offering_id INT UNSIGNED NOT NULL,
  room_id INT UNSIGNED NOT NULL,
  `day` ENUM('MON','TUE','WED','THU','FRI','SAT','SUN') NOT NULL,
  session_date DATE NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  start_slot_id INT UNSIGNED NULL,
  slot_count TINYINT UNSIGNED NULL,
  UNIQUE KEY uq_session_version (session_id, version_id),
  KEY ix_session_room (version_id, room_id, `day`, start_time),
  CONSTRAINT fk_ss_version FOREIGN KEY (version_id, term_id) REFERENCES timetable_versions(version_id, term_id),
  CONSTRAINT fk_ss_offering FOREIGN KEY (offering_id, term_id) REFERENCES course_offerings(offering_id, term_id),
  CONSTRAINT fk_ss_room FOREIGN KEY (room_id) REFERENCES rooms(room_id),
  CONSTRAINT fk_ss_slot FOREIGN KEY (start_slot_id, term_id) REFERENCES time_slots(slot_id, term_id),
  CONSTRAINT ck_ss_time CHECK (end_time > start_time)
) ENGINE=InnoDB;

-- @@

CREATE TABLE session_audiences (
  session_audience_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  version_id BIGINT UNSIGNED NOT NULL,
  section_id INT UNSIGNED NOT NULL,
  batch_id INT UNSIGNED NULL,
  batch_key INT UNSIGNED GENERATED ALWAYS AS (IFNULL(batch_id, 0)) STORED,
  UNIQUE KEY uq_session_aud (session_id, section_id, batch_key),
  CONSTRAINT fk_sa_session FOREIGN KEY (session_id, version_id) REFERENCES scheduled_sessions(session_id, version_id) ON DELETE CASCADE,
  CONSTRAINT fk_sa_section FOREIGN KEY (section_id) REFERENCES sections(section_id),
  CONSTRAINT fk_sa_batch FOREIGN KEY (batch_id, section_id) REFERENCES batches(batch_id, section_id)
) ENGINE=InnoDB;

-- @@

CREATE TABLE session_faculty (
  session_faculty_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  version_id BIGINT UNSIGNED NOT NULL,
  faculty_id BIGINT UNSIGNED NOT NULL,
  role ENUM('UNSPECIFIED','LECTURER','LAB_LEAD','LAB_ASSISTANT','TUTOR') NOT NULL DEFAULT 'UNSPECIFIED',
  UNIQUE KEY uq_session_fac (session_id, faculty_id),
  CONSTRAINT fk_sf_session FOREIGN KEY (session_id, version_id) REFERENCES scheduled_sessions(session_id, version_id) ON DELETE CASCADE,
  CONSTRAINT fk_sf_faculty FOREIGN KEY (faculty_id) REFERENCES faculty_profiles(faculty_id)
) ENGINE=InnoDB;

-- @@

CREATE TABLE validation_runs (
  validation_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_id BIGINT UNSIGNED NULL,
  version_id BIGINT UNSIGNED NULL,
  validation_type VARCHAR(40) NOT NULL,
  status ENUM('RUNNING','PASSED','FAILED') NOT NULL DEFAULT 'RUNNING',
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME NULL,
  CONSTRAINT fk_vr_run FOREIGN KEY (run_id) REFERENCES generation_runs(run_id),
  CONSTRAINT fk_vr_version FOREIGN KEY (version_id) REFERENCES timetable_versions(version_id)
) ENGINE=InnoDB;

-- @@

CREATE TABLE validation_issues (
  issue_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  validation_id BIGINT UNSIGNED NOT NULL,
  severity ENUM('ERROR','WARNING','INFO') NOT NULL,
  rule_code VARCHAR(60) NOT NULL,
  message VARCHAR(500) NOT NULL,
  details_json JSON NULL,
  status ENUM('OPEN','ACKNOWLEDGED','RESOLVED') NOT NULL DEFAULT 'OPEN',
  CONSTRAINT fk_vi_validation FOREIGN KEY (validation_id) REFERENCES validation_runs(validation_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- @@

-- action_type is generic because the Coordinator workflow is provisional (needs university confirmation).
CREATE TABLE approval_actions (
  approval_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  version_id BIGINT UNSIGNED NOT NULL,
  action_type ENUM('SUBMIT_FOR_REVIEW','ADMIN_REVIEW','REQUEST_CHANGES','APPROVE','REJECT','PUBLISH','OVERRIDE_UNKNOWN_AVAILABILITY') NOT NULL,
  actor_id BIGINT UNSIGNED NOT NULL,
  actor_role ENUM('ADMIN','FACULTY','STUDENT','COORDINATOR') NOT NULL,
  action_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  comment TEXT NULL,
  CONSTRAINT fk_aa_version FOREIGN KEY (version_id) REFERENCES timetable_versions(version_id),
  CONSTRAINT fk_aa_actor FOREIGN KEY (actor_id) REFERENCES users(user_id)
) ENGINE=InnoDB;

-- @@

-- Published versions are immutable. (Cascaded FK actions do not fire triggers, but published
-- versions cannot be deleted, so their children cannot be cascaded away.)
CREATE TRIGGER trg_tv_immutable_upd BEFORE UPDATE ON timetable_versions
FOR EACH ROW
BEGIN
  IF OLD.status = 'PUBLISHED' AND (NEW.status NOT IN ('PUBLISHED','ARCHIVED')
      OR NEW.term_id <> OLD.term_id OR NEW.version_no <> OLD.version_no
      OR NOT (NEW.published_at <=> OLD.published_at)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Published timetable versions are immutable';
  END IF;
END

-- @@

CREATE TRIGGER trg_tv_immutable_del BEFORE DELETE ON timetable_versions
FOR EACH ROW
BEGIN
  IF OLD.status = 'PUBLISHED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Published timetable versions cannot be deleted';
  END IF;
END

-- @@

CREATE TRIGGER trg_ss_immutable_ins BEFORE INSERT ON scheduled_sessions
FOR EACH ROW
BEGIN
  IF (SELECT status FROM timetable_versions WHERE version_id = NEW.version_id) = 'PUBLISHED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Published timetable versions are immutable';
  END IF;
END

-- @@

CREATE TRIGGER trg_ss_immutable_upd BEFORE UPDATE ON scheduled_sessions
FOR EACH ROW
BEGIN
  IF (SELECT status FROM timetable_versions WHERE version_id = OLD.version_id) = 'PUBLISHED'
     OR (SELECT status FROM timetable_versions WHERE version_id = NEW.version_id) = 'PUBLISHED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Published timetable versions are immutable';
  END IF;
END

-- @@

CREATE TRIGGER trg_ss_immutable_del BEFORE DELETE ON scheduled_sessions
FOR EACH ROW
BEGIN
  IF (SELECT status FROM timetable_versions WHERE version_id = OLD.version_id) = 'PUBLISHED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Published timetable versions are immutable';
  END IF;
END

-- @@

CREATE TRIGGER trg_sa_immutable_ins BEFORE INSERT ON session_audiences
FOR EACH ROW
BEGIN
  IF (SELECT status FROM timetable_versions WHERE version_id = NEW.version_id) = 'PUBLISHED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Published timetable versions are immutable';
  END IF;
END

-- @@

CREATE TRIGGER trg_sa_immutable_del BEFORE DELETE ON session_audiences
FOR EACH ROW
BEGIN
  IF (SELECT status FROM timetable_versions WHERE version_id = OLD.version_id) = 'PUBLISHED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Published timetable versions are immutable';
  END IF;
END

-- @@

CREATE TRIGGER trg_sf_immutable_ins BEFORE INSERT ON session_faculty
FOR EACH ROW
BEGIN
  IF (SELECT status FROM timetable_versions WHERE version_id = NEW.version_id) = 'PUBLISHED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Published timetable versions are immutable';
  END IF;
END

-- @@

CREATE TRIGGER trg_sf_immutable_del BEFORE DELETE ON session_faculty
FOR EACH ROW
BEGIN
  IF (SELECT status FROM timetable_versions WHERE version_id = OLD.version_id) = 'PUBLISHED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Published timetable versions are immutable';
  END IF;
END

-- @@

-- Approval-type actions are blocked while unknown availability is unresolved (decision H).
CREATE TRIGGER trg_aa_unknown_gate BEFORE INSERT ON approval_actions
FOR EACH ROW
BEGIN
  IF NEW.action_type IN ('SUBMIT_FOR_REVIEW','APPROVE','PUBLISH')
     AND (SELECT availability_unknown_status FROM timetable_versions WHERE version_id = NEW.version_id) = 'OPEN' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Unknown faculty availability must be resolved or overridden first';
  END IF;
END
