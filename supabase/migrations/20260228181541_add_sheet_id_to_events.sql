-- Add sheet_id column to events table for per-event Google Sheet routing
ALTER TABLE events ADD COLUMN IF NOT EXISTS sheet_id TEXT;

-- Backfill the existing Michigan City Ford event with the current default spreadsheet
UPDATE events
SET sheet_id = '10NUwAoUAsHsSCL4GrTiwjumvpa3TqMN56wqQ-rFPfrA'
WHERE id = 'a48caaf4-ea1b-416b-9812-22c9381d1e45';
