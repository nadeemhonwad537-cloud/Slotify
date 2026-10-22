ALTER TABLE sections
  ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER strength,
  DROP INDEX uq_section_name,
  ADD UNIQUE KEY uq_section_context_name (term_id, scheme_id, semester_id, section_name);

CREATE TABLE term_program_semesters (
  term_program_semester_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  term_id INT UNSIGNED NOT NULL,
  scheme_id INT UNSIGNED NOT NULL,
  semester_id INT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_tps_context (term_id, scheme_id, semester_id),
  CONSTRAINT fk_tps_term FOREIGN KEY (term_id) REFERENCES terms(term_id),
  CONSTRAINT fk_tps_semester FOREIGN KEY (semester_id, scheme_id) REFERENCES semesters(semester_id, scheme_id)
) ENGINE=InnoDB;

INSERT INTO term_program_semesters (term_id, scheme_id, semester_id)
SELECT DISTINCT term_id, scheme_id, semester_id
FROM sections;

ALTER TABLE sections
  ADD CONSTRAINT fk_sections_term_program_semester
    FOREIGN KEY (term_id, scheme_id, semester_id)
    REFERENCES term_program_semesters(term_id, scheme_id, semester_id);
