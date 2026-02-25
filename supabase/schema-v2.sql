-- ============================================================
-- JDE MISSION CONTROL - COMPLETE SCHEMA V2
-- Based on LINCOLN CDJR FEB/MARCH 26 Control Spreadsheet
-- ============================================================

-- ========================
-- 1. EVENT CONFIG
-- ========================
CREATE TABLE IF NOT EXISTS event_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  dealer_name text,
  franchise text,
  city text,
  state text,
  zip text,
  sale_days integer DEFAULT 6,
  doc_fee numeric(10,2) DEFAULT 377.65,
  tax_rate numeric(5,4) DEFAULT 0.0625,
  pack numeric(10,2) DEFAULT 0,
  mail_title text,
  mail_pieces integer,
  jde_commission_pct numeric(5,4) DEFAULT 0.35,
  rep_commission_pct numeric(5,4) DEFAULT 0.25,
  target_units integer,
  target_avg_gross numeric(10,2),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ========================
-- 2. ROSTER (Salespeople)
-- ========================
CREATE TABLE IF NOT EXISTS roster (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  role text DEFAULT 'sales',  -- sales, team_leader, fi_manager, closer
  team text,                   -- Team A, Team B, etc.
  confirmed boolean DEFAULT false,
  commission_pct numeric(5,4) DEFAULT 0.25,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ========================
-- 3. LENDERS
-- ========================
CREATE TABLE IF NOT EXISTS lenders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL,
  buy_rate_pct numeric(5,4),
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ========================
-- 4. DEALERSHIP CREDENTIALS
-- ========================
CREATE TABLE IF NOT EXISTS dealership_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  system_name text NOT NULL,     -- RouteOne, DealerConnect, Autosoft, etc.
  username text,
  password text,
  email text,
  url text,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ========================
-- 5. INVENTORY (Vehicles)
-- ========================
CREATE TABLE IF NOT EXISTS vehicle_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  hat_number integer,
  status_label text,            -- TRADE, LOANER, etc.
  sold_status text DEFAULT 'available',  -- available, sold, hold
  stock_number text,
  year integer,
  make text,
  model text,
  class text,                   -- SUV, Sedan, Truck, Hatch, Van, etc.
  color text,
  odometer integer,
  vin text,
  series_trim text,
  age_days integer,
  drivetrain text,              -- FWD, RWD, AWD, 4x4
  -- Pricing
  jd_trade_clean numeric(10,2),   -- J.D. Power Trade-In Clean
  jd_retail_clean numeric(10,2),  -- J.D. Power Retail Clean
  unit_cost numeric(10,2),
  -- Calculated fields (stored for performance)
  cost_diff numeric(10,2),        -- jd_trade_clean - unit_cost
  price_115 numeric(10,2),        -- jd_trade_clean * 1.15
  profit_115 numeric(10,2),       -- price_115 - unit_cost
  price_120 numeric(10,2),        -- jd_trade_clean * 1.20
  profit_120 numeric(10,2),       -- price_120 - unit_cost
  price_125 numeric(10,2),        -- jd_trade_clean * 1.25
  profit_125 numeric(10,2),       -- price_125 - unit_cost
  price_130 numeric(10,2),        -- jd_trade_clean * 1.30
  profit_130 numeric(10,2),       -- price_130 - unit_cost
  retail_spread numeric(10,2),    -- jd_retail_clean - unit_cost
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ========================
-- 6. DEALS (Deal Log)
-- ========================
CREATE TABLE IF NOT EXISTS deals_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  deal_number integer,
  sale_day integer,               -- Day 1, Day 2, etc.
  sale_date date,
  funded boolean DEFAULT false,
  store text,
  stock_number text,
  customer_name text,
  zip_code text,
  new_used text,                  -- New, Used, Trade
  -- Purchase vehicle
  purchase_year integer,
  purchase_make text,
  purchase_model text,
  purchase_type text,             -- SUV, Sedan, Truck
  vehicle_cost numeric(10,2),
  vehicle_age integer,
  -- Trade vehicle
  trade_year integer,
  trade_make text,
  trade_model text,
  trade_type text,
  trade_miles integer,
  trade_acv numeric(10,2),
  trade_payoff numeric(10,2),
  -- Sales info
  salesperson text,
  salesperson_pct numeric(5,4) DEFAULT 1.0,
  second_salesperson text,
  second_salesperson_pct numeric(5,4),
  -- Financials
  front_gross numeric(10,2),
  lender text,
  rate numeric(5,4),
  reserve numeric(10,2),
  warranty numeric(10,2),
  aft1 numeric(10,2),             -- Aftermarket 1
  aft2 numeric(10,2),             -- Aftermarket 2
  gap numeric(10,2),
  doc_fee numeric(10,2),
  fi_total numeric(10,2),         -- SUM(reserve + warranty + aft1 + aft2 + gap)
  total_gross numeric(10,2),      -- front_gross + fi_total
  -- Additional gross columns
  daily_gross numeric(10,2),
  add_gross numeric(10,2),
  dealer_gross numeric(10,2),
  jde_pay numeric(10,2),
  source text,                    -- Mail, Walk-in, Be-back, etc.
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ========================
-- 7. MAIL TRACKING
-- ========================
CREATE TABLE IF NOT EXISTS mail_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  campaign_name text,
  zip_code text,
  town text,
  pieces_sent integer,
  day1_responses integer DEFAULT 0,
  day2_responses integer DEFAULT 0,
  day3_responses integer DEFAULT 0,
  day4_responses integer DEFAULT 0,
  day5_responses integer DEFAULT 0,
  day6_responses integer DEFAULT 0,
  day7_responses integer DEFAULT 0,
  total_responses integer DEFAULT 0,
  response_rate numeric(5,4),
  sold_count integer DEFAULT 0,
  sold_pct numeric(5,4),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ========================
-- 8. DAILY PERFORMANCE
-- ========================
CREATE TABLE IF NOT EXISTS daily_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  salesperson text NOT NULL,
  sale_day integer NOT NULL,      -- 1-12
  sale_date date,
  ups integer DEFAULT 0,
  sold integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(event_id, salesperson, sale_day)
);

-- ========================
-- 9. COMMISSIONS
-- ========================
CREATE TABLE IF NOT EXISTS commission_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  salesperson text NOT NULL,
  full_deals integer DEFAULT 0,
  split_deals integer DEFAULT 0,
  total_front_gross numeric(10,2) DEFAULT 0,
  commission_amount numeric(10,2) DEFAULT 0,
  pack_total numeric(10,2) DEFAULT 0,
  bonus numeric(10,2) DEFAULT 0,
  chargebacks numeric(10,2) DEFAULT 0,
  net_pay numeric(10,2) DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ========================
-- 10. CHARGEBACKS
-- ========================
CREATE TABLE IF NOT EXISTS chargebacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  deal_number text,
  description text,
  amount numeric(10,2),
  salesperson text,
  created_at timestamptz DEFAULT now()
);

-- ========================
-- 11. ZIP CODE ANALYTICS
-- ========================
CREATE TABLE IF NOT EXISTS zip_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  zip_code text NOT NULL,
  town text,
  distance_miles numeric(6,1),
  total_ups integer DEFAULT 0,
  total_sold integer DEFAULT 0,
  ups_pct numeric(5,4),
  sold_pct numeric(5,4),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ========================
-- RLS POLICIES
-- ========================
ALTER TABLE event_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE lenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealership_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE chargebacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE zip_analytics ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all data
CREATE POLICY "Authenticated users can read event_config" ON event_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can manage event_config" ON event_config FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read roster" ON roster FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can manage roster" ON roster FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read lenders" ON lenders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can manage lenders" ON lenders FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read credentials" ON dealership_credentials FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can manage credentials" ON dealership_credentials FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read vehicle_inventory" ON vehicle_inventory FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can manage vehicle_inventory" ON vehicle_inventory FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read deals_v2" ON deals_v2 FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can manage deals_v2" ON deals_v2 FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read mail_tracking" ON mail_tracking FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can manage mail_tracking" ON mail_tracking FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read daily_performance" ON daily_performance FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can manage daily_performance" ON daily_performance FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read commission_summary" ON commission_summary FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can manage commission_summary" ON commission_summary FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read chargebacks" ON chargebacks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can manage chargebacks" ON chargebacks FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read zip_analytics" ON zip_analytics FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can manage zip_analytics" ON zip_analytics FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ========================
-- INDEXES
-- ========================
CREATE INDEX IF NOT EXISTS idx_vehicle_inventory_event ON vehicle_inventory(event_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_inventory_status ON vehicle_inventory(sold_status);
CREATE INDEX IF NOT EXISTS idx_deals_v2_event ON deals_v2(event_id);
CREATE INDEX IF NOT EXISTS idx_deals_v2_salesperson ON deals_v2(salesperson);
CREATE INDEX IF NOT EXISTS idx_deals_v2_sale_day ON deals_v2(sale_day);
CREATE INDEX IF NOT EXISTS idx_mail_tracking_event ON mail_tracking(event_id);
CREATE INDEX IF NOT EXISTS idx_roster_event ON roster(event_id);
CREATE INDEX IF NOT EXISTS idx_daily_performance_event ON daily_performance(event_id);
CREATE INDEX IF NOT EXISTS idx_commission_summary_event ON commission_summary(event_id);

-- ========================
-- UPDATED_AT TRIGGERS
-- ========================
CREATE OR REPLACE FUNCTION update_updated_at_v2()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_event_config_updated_at BEFORE UPDATE ON event_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_v2();
CREATE TRIGGER update_roster_updated_at BEFORE UPDATE ON roster FOR EACH ROW EXECUTE FUNCTION update_updated_at_v2();
CREATE TRIGGER update_vehicle_inventory_updated_at BEFORE UPDATE ON vehicle_inventory FOR EACH ROW EXECUTE FUNCTION update_updated_at_v2();
CREATE TRIGGER update_deals_v2_updated_at BEFORE UPDATE ON deals_v2 FOR EACH ROW EXECUTE FUNCTION update_updated_at_v2();
CREATE TRIGGER update_mail_tracking_updated_at BEFORE UPDATE ON mail_tracking FOR EACH ROW EXECUTE FUNCTION update_updated_at_v2();
CREATE TRIGGER update_commission_summary_updated_at BEFORE UPDATE ON commission_summary FOR EACH ROW EXECUTE FUNCTION update_updated_at_v2();
CREATE TRIGGER update_zip_analytics_updated_at BEFORE UPDATE ON zip_analytics FOR EACH ROW EXECUTE FUNCTION update_updated_at_v2();

-- ========================
-- REALTIME
-- ========================
ALTER PUBLICATION supabase_realtime ADD TABLE vehicle_inventory;
ALTER PUBLICATION supabase_realtime ADD TABLE deals_v2;
ALTER PUBLICATION supabase_realtime ADD TABLE daily_performance;
ALTER PUBLICATION supabase_realtime ADD TABLE mail_tracking;
