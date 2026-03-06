-- Add closer tracking to sales_deals
ALTER TABLE sales_deals
  ADD COLUMN IF NOT EXISTS closer text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS closer_id uuid DEFAULT NULL;

-- Foreign key: closer_id → roster(id)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'sales_deals_closer_id_fkey'
      AND table_name = 'sales_deals'
  ) THEN
    ALTER TABLE sales_deals
      ADD CONSTRAINT sales_deals_closer_id_fkey
      FOREIGN KEY (closer_id) REFERENCES roster(id)
      ON DELETE SET NULL;
  END IF;
END $$;
