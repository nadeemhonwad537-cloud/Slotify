-- Persist the exact committed write summary for each repeatable workload import.
ALTER TABLE workload_import_batches
  ADD COLUMN import_summary JSON NULL AFTER status;
