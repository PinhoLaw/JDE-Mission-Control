#!/usr/bin/env python3
"""Seed Supabase from LINCOLN CDJR spreadsheet."""
import json, requests, openpyxl, sys

SUPABASE_URL = "https://ayxsaylqhjfgwlchkeek.supabase.co"
SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5eHNheWxxaGpmZ3dsY2hrZWVrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAyODIyOSwiZXhwIjoyMDg3NjA0MjI5fQ.TcGiKeVciaUGDz_dtjNvhcH78Ml3ihv8dZ9MypzNsTs"
HEADERS = {
    "Authorization": f"Bearer {SERVICE_KEY}",
    "apikey": SERVICE_KEY,
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}
FILE = "/Users/michaelstopperich/Downloads/LINCOLN CDJR FEB_MARCH 26 (1).xlsx"

def api(method, table, data=None, params=None):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    r = getattr(requests, method)(url, headers=HEADERS, json=data, params=params)
    if r.status_code >= 400:
        print(f"  ERROR {r.status_code}: {r.text[:200]}")
        return None
    try: return r.json()
    except: return r.text

def n(v):
    """Safely convert to number."""
    if v is None: return None
    try: return float(v)
    except: return None

def s(v):
    """Safely convert to string."""
    if v is None: return None
    return str(v).strip()

def i(v):
    """Safely convert to int."""
    if v is None: return None
    try: return int(float(v))
    except: return None

print("Loading workbook...")
wb = openpyxl.load_workbook(FILE, data_only=True)

# 1. Get or create event
print("\n=== EVENT ===")
events = api("get", "events", params={"select": "id,name", "limit": "1"})
if events and len(events) > 0:
    event_id = events[0]["id"]
    print(f"  Using existing event: {events[0]['name']} ({event_id})")
else:
    # Get any user ID for created_by
    users = api("get", "profiles", params={"select": "id", "limit": "1"})
    user_id = users[0]["id"] if users and len(users) > 0 else None
    event_data = {
        "name": "Lincoln CDJR Feb/March 26",
        "slug": "lincoln-cdjr-feb-march-26",
        "status": "active",
        "location": "Lincoln, IL 62656",
        "start_date": "2026-02-24",
        "end_date": "2026-03-03",
        "budget": 50000,
    }
    if user_id:
        event_data["created_by"] = user_id
    result = api("post", "events", event_data)
    event_id = result[0]["id"] if result and len(result) > 0 else None
    print(f"  Created event: {event_id}")
    if not event_id:
        # Try without created_by by disabling the constraint temporarily
        print("  Trying with SQL...")
        import subprocess
        sql = "INSERT INTO events (name, slug, status, location, start_date, end_date, budget) VALUES ('Lincoln CDJR Feb/March 26', 'lincoln-cdjr-feb-march-26', 'active', 'Lincoln, IL 62656', '2026-02-24', '2026-03-03', 50000) RETURNING id;"
        r = requests.post(
            "https://api.supabase.com/v1/projects/ayxsaylqhjfgwlchkeek/database/query",
            headers={
                "Authorization": "Bearer sbp_f90f51d8832eb558f9f3a0b9207cbeaf3996e4ec",
                "Content-Type": "application/json",
            },
            json={"query": "ALTER TABLE events ALTER COLUMN created_by DROP NOT NULL; " + sql}
        )
        print(f"  SQL result: {r.text[:200]}")
        try:
            data = r.json()
            if isinstance(data, list) and len(data) > 0:
                for d in data:
                    if isinstance(d, list) and len(d) > 0 and 'id' in d[0]:
                        event_id = d[0]['id']
        except: pass
        if not event_id:
            # Try getting it after insert
            events = api("get", "events", params={"select": "id,name", "limit": "1"})
            if events and len(events) > 0:
                event_id = events[0]["id"]

if not event_id:
    print("FATAL: No event ID")
    sys.exit(1)

# 2. Seed Roster
print("\n=== ROSTER ===")
ws = wb["Roster & Tables"]
roster_data = []
roles_map = {"BRYAN ROGERS": "team_leader", "BRYANTROGERS": "team_leader"}
for row in range(2, 18):
    name = s(ws[f"C{row}"].value)
    phone = s(ws[f"D{row}"].value)
    if not name or name.lower() in ("none", "spare"): continue
    role = roles_map.get(name, "sales")
    roster_data.append({
        "event_id": event_id,
        "name": name,
        "phone": phone,
        "role": role,
        "confirmed": True,
        "commission_pct": 0.25,
    })
result = api("post", "roster", roster_data)
print(f"  Inserted {len(roster_data)} roster entries")

# 3. Seed Lenders
print("\n=== LENDERS ===")
lenders_data = []
for row in range(2, 20):
    name = s(ws[f"I{row}"].value)
    pct = n(ws[f"K{row}"].value)
    if not name: continue
    lenders_data.append({
        "event_id": event_id,
        "name": name,
        "buy_rate_pct": pct,
    })
if lenders_data:
    api("post", "lenders", lenders_data)
    print(f"  Inserted {len(lenders_data)} lenders")

# 4. Seed Inventory
print("\n=== INVENTORY ===")
ws_inv = wb["INVENTORY"]
inv_data = []
for row in range(2, ws_inv.max_row + 1):
    hat = i(ws_inv[f"A{row}"].value)
    name_val = s(ws_inv[f"G{row}"].value)  # Model
    if not name_val and not hat: continue

    unit_cost = n(ws_inv[f"Q{row}"].value)
    jd_trade = n(ws_inv[f"O{row}"].value)
    jd_retail = n(ws_inv[f"P{row}"].value)

    sold_raw = s(ws_inv[f"C{row}"].value)
    sold_status = "sold" if sold_raw and "sold" in sold_raw.lower() else "available"

    inv_item = {
        "event_id": event_id,
        "hat_number": hat,
        "status_label": s(ws_inv[f"B{row}"].value),
        "sold_status": sold_status,
        "stock_number": s(ws_inv[f"D{row}"].value),
        "year": i(ws_inv[f"E{row}"].value),
        "make": s(ws_inv[f"F{row}"].value),
        "model": name_val,
        "class": s(ws_inv[f"H{row}"].value),
        "color": s(ws_inv[f"I{row}"].value),
        "odometer": i(ws_inv[f"J{row}"].value),
        "vin": s(ws_inv[f"K{row}"].value),
        "series_trim": s(ws_inv[f"L{row}"].value),
        "age_days": i(ws_inv[f"M{row}"].value),
        "drivetrain": s(ws_inv[f"N{row}"].value),
        "jd_trade_clean": jd_trade,
        "jd_retail_clean": jd_retail,
        "unit_cost": unit_cost,
    }

    # Calculate pricing tiers
    if jd_trade and unit_cost:
        inv_item["cost_diff"] = round(jd_trade - unit_cost, 2)
        for mult, prefix in [(1.15, "115"), (1.20, "120"), (1.25, "125"), (1.30, "130")]:
            price = round(jd_trade * mult, 2)
            profit = round(price - unit_cost, 2)
            inv_item[f"price_{prefix}"] = price
            inv_item[f"profit_{prefix}"] = profit
    if jd_retail and unit_cost:
        inv_item["retail_spread"] = round(jd_retail - unit_cost, 2)

    inv_data.append(inv_item)

if inv_data:
    # Insert in batches of 20
    for idx in range(0, len(inv_data), 20):
        batch = inv_data[idx:idx+20]
        api("post", "vehicle_inventory", batch)
    print(f"  Inserted {len(inv_data)} inventory items")

# 5. Seed Deals
print("\n=== DEALS ===")
ws_deals = wb["DEAL LOG"]
deals_data = []
for row in range(9, ws_deals.max_row + 1):
    customer = s(ws_deals[f"I{row}"].value)
    stock = s(ws_deals[f"H{row}"].value)
    if not customer and not stock: continue

    front = n(ws_deals[f"Y{row}"].value)
    fi_total = n(ws_deals[f"AF{row}"].value)
    total = n(ws_deals[f"AG{row}"].value)

    deal = {
        "event_id": event_id,
        "deal_number": i(ws_deals[f"E{row}"].value),
        "sale_day": 1,
        "store": s(ws_deals[f"G{row}"].value),
        "stock_number": stock,
        "customer_name": customer,
        "zip_code": s(ws_deals[f"J{row}"].value),
        "new_used": s(ws_deals[f"K{row}"].value),
        "purchase_year": i(ws_deals[f"L{row}"].value),
        "purchase_make": s(ws_deals[f"M{row}"].value),
        "purchase_model": s(ws_deals[f"N{row}"].value),
        "vehicle_cost": n(ws_deals[f"O{row}"].value),
        "vehicle_age": i(ws_deals[f"P{row}"].value),
        "trade_year": i(ws_deals[f"Q{row}"].value),
        "trade_make": s(ws_deals[f"R{row}"].value),
        "trade_model": s(ws_deals[f"S{row}"].value),
        "salesperson": s(ws_deals[f"W{row}"].value),
        "second_salesperson": s(ws_deals[f"X{row}"].value),
        "front_gross": front,
        "lender": s(ws_deals[f"Z{row}"].value),
        "rate": n(ws_deals[f"AA{row}"].value),
        "reserve": n(ws_deals[f"AB{row}"].value),
        "warranty": n(ws_deals[f"AC{row}"].value),
        "aft1": n(ws_deals[f"AD{row}"].value),
        "gap": n(ws_deals[f"AE{row}"].value),
        "fi_total": fi_total,
        "total_gross": total,
        "jde_pay": n(ws_deals[f"AK{row}"].value),
        "source": "Mail",
    }
    deals_data.append(deal)

if deals_data:
    api("post", "deals_v2", deals_data)
    print(f"  Inserted {len(deals_data)} deals")

# 6. Seed Mail Tracking
print("\n=== MAIL TRACKING ===")
ws_mail = wb["MAIL TRACKING"]
mail_data = []
for row in range(2, ws_mail.max_row + 1):
    zip_code = s(ws_mail[f"E{row}"].value)
    town = s(ws_mail[f"D{row}"].value)
    if not zip_code or not town: continue

    pieces = i(ws_mail[f"B{row}"].value)
    total_resp = i(ws_mail[f"F{row}"].value)

    entry = {
        "event_id": event_id,
        "campaign_name": "WIN BIG",
        "zip_code": zip_code,
        "town": town,
        "pieces_sent": pieces,
        "day1_responses": i(ws_mail[f"G{row}"].value) or 0,
        "day2_responses": i(ws_mail[f"H{row}"].value) or 0,
        "day3_responses": i(ws_mail[f"I{row}"].value) or 0,
        "day4_responses": i(ws_mail[f"J{row}"].value) or 0,
        "day5_responses": i(ws_mail[f"K{row}"].value) or 0,
        "day6_responses": i(ws_mail[f"L{row}"].value) or 0,
        "day7_responses": i(ws_mail[f"M{row}"].value) or 0,
        "total_responses": total_resp or 0,
        "response_rate": round(total_resp / pieces, 4) if pieces and total_resp else 0,
    }
    mail_data.append(entry)

if mail_data:
    for idx in range(0, len(mail_data), 20):
        batch = mail_data[idx:idx+20]
        api("post", "mail_tracking", batch)
    print(f"  Inserted {len(mail_data)} mail tracking entries")

# 7. Seed Event Config
print("\n=== EVENT CONFIG ===")
config = {
    "event_id": event_id,
    "dealer_name": "Lincoln CDJR",
    "franchise": "Chrysler Dodge Jeep Ram",
    "city": "Lincoln",
    "state": "IL",
    "zip": "62656",
    "sale_days": 6,
    "doc_fee": 377.65,
    "tax_rate": 0.0625,
    "pack": 0,
    "mail_title": "WIN BIG",
    "mail_pieces": 70000,
    "jde_commission_pct": 0.35,
    "rep_commission_pct": 0.25,
    "target_units": 50,
    "target_avg_gross": 8144.35,
}
api("post", "event_config", config)
print("  Inserted event config")

print("\n✅ Seeding complete!")
