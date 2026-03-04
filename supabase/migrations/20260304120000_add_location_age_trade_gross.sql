-- ============================================================
-- Migration: Add location to inventory, vehicle_age + trade_vehicle_id
-- to deals, gross_from_mail to mail_tracking
-- ============================================================

-- 1. vehicle_inventory: add location column (free text)
ALTER TABLE vehicle_inventory
  ADD COLUMN IF NOT EXISTS location text DEFAULT NULL;

-- 2. sales_deals: add vehicle_age (integer, days on lot at time of sale)
ALTER TABLE sales_deals
  ADD COLUMN IF NOT EXISTS vehicle_age integer DEFAULT NULL;

-- 3. sales_deals: add trade_vehicle_id FK to vehicle_inventory
ALTER TABLE sales_deals
  ADD COLUMN IF NOT EXISTS trade_vehicle_id uuid DEFAULT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'sales_deals_trade_vehicle_id_fkey'
      AND table_name = 'sales_deals'
  ) THEN
    ALTER TABLE sales_deals
      ADD CONSTRAINT sales_deals_trade_vehicle_id_fkey
      FOREIGN KEY (trade_vehicle_id) REFERENCES vehicle_inventory(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 4. mail_tracking: add gross_from_mail (sum of total_gross for deals matching zip)
ALTER TABLE mail_tracking
  ADD COLUMN IF NOT EXISTS gross_from_mail numeric DEFAULT 0;
