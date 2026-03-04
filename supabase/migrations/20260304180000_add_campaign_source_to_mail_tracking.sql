-- Add campaign_source to distinguish "Campaign Tracking" (current) from historical sheets
ALTER TABLE mail_tracking ADD COLUMN IF NOT EXISTS campaign_source TEXT NOT NULL DEFAULT 'current';

-- Index for quick filtering by source
CREATE INDEX IF NOT EXISTS idx_mail_tracking_campaign_source ON mail_tracking(event_id, campaign_source);

-- Backfill: all existing rows are from the current campaign
UPDATE mail_tracking SET campaign_source = 'current' WHERE campaign_source IS NULL;
