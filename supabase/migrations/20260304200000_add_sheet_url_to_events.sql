-- Google Sheets auto-creation — replaces Excel upload flow (March 2026)
-- Add sheet_url column so we can store the full shareable link alongside sheet_id
ALTER TABLE events ADD COLUMN IF NOT EXISTS sheet_url TEXT;
