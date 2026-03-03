-- Add is_trade_turn flag to sales_deals
-- "TI" (Trade-In Turn) = the vehicle being sold was originally a trade-in
-- from another deal at this event, turned around and resold.
ALTER TABLE sales_deals
  ADD COLUMN IF NOT EXISTS is_trade_turn boolean NOT NULL DEFAULT false;

-- Optional: index for quick filtering of TI deals
CREATE INDEX IF NOT EXISTS idx_sales_deals_trade_turn
  ON sales_deals (event_id)
  WHERE is_trade_turn = true;
