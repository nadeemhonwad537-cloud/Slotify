-- Slotify migration 009: persist editable curriculum-builder rows by academic context.
-- Rollback before storing user drafts: DROP TABLE curriculum_drafts;
CREATE TABLE curriculum_drafts (
  draft_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  year_id INT UNSIGNED NOT NULL,
  term_id INT UNSIGNED NOT NULL,
  program_id INT UNSIGNED NOT NULL,
  scheme_id INT UNSIGNED NOT NULL,
  semester_id INT UNSIGNED NOT NULL,
  draft_payload JSON NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_curriculum_draft_context (year_id, term_id, program_id, scheme_id, semester_id),
  KEY ix_curriculum_drafts_updated_at (updated_at),
  CONSTRAINT fk_curriculum_draft_year FOREIGN KEY (year_id) REFERENCES academic_years(year_id),
  CONSTRAINT fk_curriculum_draft_term FOREIGN KEY (term_id) REFERENCES terms(term_id),
  CONSTRAINT fk_curriculum_draft_program FOREIGN KEY (program_id) REFERENCES programs(program_id),
  CONSTRAINT fk_curriculum_draft_scheme FOREIGN KEY (scheme_id) REFERENCES curriculum_schemes(scheme_id),
  CONSTRAINT fk_curriculum_draft_semester FOREIGN KEY (semester_id, scheme_id) REFERENCES semesters(semester_id, scheme_id),
  CONSTRAINT fk_curriculum_draft_creator FOREIGN KEY (created_by) REFERENCES users(user_id),
  CONSTRAINT fk_curriculum_draft_updater FOREIGN KEY (updated_by) REFERENCES users(user_id),
  CONSTRAINT ck_curriculum_draft_version CHECK (version >= 1)
) ENGINE=InnoDB;
