-- =============================================================================
-- Maqass (مِقَصْ) — Barbershop Management System (Supabase SQL Schema)
-- Production Hardened Edition for GitHub Pages & Supabase Free Tier
-- =============================================================================

-- Enable required extensions at the very top
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- =============================================================================
-- 1. SALON SETTINGS (Single-tenant Barbershop Settings & Live Ticker)
-- =============================================================================
CREATE TABLE IF NOT EXISTS salon_settings (
  id            INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  salon_name    TEXT NOT NULL DEFAULT 'صالون الحلاقة',
  phone         TEXT NOT NULL DEFAULT '01000000000',
  working_hours JSONB NOT NULL DEFAULT '{
    "0": { "day_ar": "الأحد",     "open": "11:00", "close": "23:00", "is_off": false },
    "1": { "day_ar": "الإثنين",   "open": "11:00", "close": "23:00", "is_off": false },
    "2": { "day_ar": "الثلاثاء",  "open": "11:00", "close": "23:00", "is_off": false },
    "3": { "day_ar": "الأربعاء",  "open": "11:00", "close": "23:00", "is_off": false },
    "4": { "day_ar": "الخميس",   "open": "11:00", "close": "23:59", "is_off": false },
    "5": { "day_ar": "الجمعة",    "open": "13:30", "close": "23:59", "is_off": false },
    "6": { "day_ar": "السبت",    "open": "11:00", "close": "23:00", "is_off": false }
  }'::jsonb,
  is_paused     BOOLEAN NOT NULL DEFAULT FALSE,
  total_views   BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default singleton row if not already present
INSERT INTO salon_settings (id, salon_name, phone, is_paused, total_views)
VALUES (1, 'مِقَصْ للحلاقة الرجالية', '01012345678', FALSE, 0)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 2. SERVICES (Catalog with duration and display-only pricing)
-- =============================================================================
CREATE TABLE IF NOT EXISTS services (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  price            NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes > 0),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_services_active ON services(is_active);

-- Seed default common Egyptian barbershop services
INSERT INTO services (name, price, duration_minutes, is_active)
VALUES 
  ('قص شعر كلاسيكي / مودرن', 70.00, 30, TRUE),
  ('تحديد وتهذيب اللحية', 40.00, 20, TRUE),
  ('سشوار وتصفيف', 30.00, 15, TRUE),
  ('ماسك وصنفرة بشرة بالبخار', 60.00, 25, TRUE),
  ('باكيدج كامل (شعر + دقن + ماسك)', 150.00, 60, TRUE)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 3. APPOINTMENTS (Schedule, Queue & Walk-ins)
-- =============================================================================
CREATE TABLE IF NOT EXISTS appointments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id       UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  client_name      TEXT NOT NULL,
  client_phone     TEXT NOT NULL,
  appointment_date DATE NOT NULL,
  start_time       TIME NOT NULL,
  end_time         TIME NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' 
                   CHECK (status IN ('pending', 'in_progress', 'completed', 'no_show', 'cancelled')),
  booking_type     TEXT NOT NULL DEFAULT 'online' 
                   CHECK (booking_type IN ('online', 'walk_in')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Strict validation: End time must strictly follow start time
  CONSTRAINT chk_appointment_time_order CHECK (end_time > start_time)
);

-- Performance Indexes (Critical for Free-Tier performance)
CREATE INDEX IF NOT EXISTS idx_appointments_date_status 
  ON appointments(appointment_date, status);

CREATE INDEX IF NOT EXISTS idx_appointments_client_phone 
  ON appointments(client_phone);

CREATE INDEX IF NOT EXISTS idx_appointments_active_queue 
  ON appointments(appointment_date, start_time)
  WHERE status IN ('pending', 'in_progress');

-- =============================================================================
-- 4. DOUBLE-BOOKING PREVENTION (Database-Enforced GiST Exclusion Constraint)
-- Completely eliminates race conditions in high-concurrency client bookings.
-- Only active statuses ('pending', 'in_progress', 'completed') hold slot locks.
-- =============================================================================
ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS no_double_booking;

ALTER TABLE appointments
  ADD CONSTRAINT no_double_booking
  EXCLUDE USING gist (
    appointment_date WITH =,
    tsrange(
      ('2000-01-01'::date + start_time)::timestamp,
      ('2000-01-01'::date + end_time)::timestamp,
      '[)'
    ) WITH &&
  )
  WHERE (status NOT IN ('cancelled', 'no_show'));

-- =============================================================================
-- 5. BLACKLIST (Clients flagged for excessive no-shows)
-- =============================================================================
CREATE TABLE IF NOT EXISTS blacklist (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_phone  TEXT NOT NULL UNIQUE,
  no_show_count INTEGER NOT NULL DEFAULT 1 CHECK (no_show_count >= 0),
  is_blocked    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blacklist_phone ON blacklist(client_phone);

-- =============================================================================
-- 6. ROW LEVEL SECURITY (RLS) POLICIES — HARDENED ACCESS CONTROL
-- Strict rules: Anonymous users can NEVER update or delete appointments.
-- All write/update/delete management strictly requires authenticated Supabase session.
-- =============================================================================

ALTER TABLE salon_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE services       ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE blacklist      ENABLE ROW LEVEL SECURITY;

-- ---- SALON SETTINGS POLICIES ----
DROP POLICY IF EXISTS "Public can view salon settings" ON salon_settings;
CREATE POLICY "Public can view salon settings" 
  ON salon_settings FOR SELECT 
  USING (TRUE);

DROP POLICY IF EXISTS "Authenticated barber can update salon settings" ON salon_settings;
CREATE POLICY "Authenticated barber can update salon settings" 
  ON salon_settings FOR UPDATE 
  TO authenticated 
  USING (auth.uid() IS NOT NULL) 
  WITH CHECK (auth.uid() IS NOT NULL);

-- ---- SERVICES POLICIES ----
DROP POLICY IF EXISTS "Public can view active services" ON services;
CREATE POLICY "Public can view active services" 
  ON services FOR SELECT 
  USING (is_active = TRUE OR auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated barber can manage services" ON services;
CREATE POLICY "Authenticated barber can manage services" 
  ON services FOR ALL 
  TO authenticated 
  USING (auth.uid() IS NOT NULL) 
  WITH CHECK (auth.uid() IS NOT NULL);

-- ---- APPOINTMENTS POLICIES ----
-- 1. Public can read appointments for date slot calculation & queue viewing
DROP POLICY IF EXISTS "Public can view appointments for slot calculation" ON appointments;
CREATE POLICY "Public can view appointments for slot calculation" 
  ON appointments FOR SELECT 
  USING (TRUE);

-- 2. Public can ONLY INSERT 'pending' bookings (cannot forge status or delete)
DROP POLICY IF EXISTS "Public can book pending appointments" ON appointments;
CREATE POLICY "Public can book pending appointments" 
  ON appointments FOR INSERT 
  WITH CHECK (
    status = 'pending' AND 
    booking_type IN ('online', 'walk_in')
  );

-- 3. STRICT: UPDATE on appointments requires authenticated barber session
DROP POLICY IF EXISTS "Authenticated barber can update appointment status" ON appointments;
CREATE POLICY "Authenticated barber can update appointment status" 
  ON appointments FOR UPDATE 
  TO authenticated 
  USING (auth.uid() IS NOT NULL) 
  WITH CHECK (auth.uid() IS NOT NULL);

-- 4. STRICT: DELETE on appointments requires authenticated barber session
DROP POLICY IF EXISTS "Authenticated barber can delete appointments" ON appointments;
CREATE POLICY "Authenticated barber can delete appointments" 
  ON appointments FOR DELETE 
  TO authenticated 
  USING (auth.uid() IS NOT NULL);

-- ---- BLACKLIST POLICIES ----
-- Public can check if phone is blocked during booking verification
DROP POLICY IF EXISTS "Public can check blacklist status" ON blacklist;
CREATE POLICY "Public can check blacklist status" 
  ON blacklist FOR SELECT 
  USING (TRUE);

-- Authenticated barber has full control over the blacklist
DROP POLICY IF EXISTS "Authenticated barber full blacklist access" ON blacklist;
CREATE POLICY "Authenticated barber full blacklist access" 
  ON blacklist FOR ALL 
  TO authenticated 
  USING (auth.uid() IS NOT NULL) 
  WITH CHECK (auth.uid() IS NOT NULL);

-- =============================================================================
-- 7. ATOMIC RPC FUNCTION: increment_views()
-- Increment the visitor counter without race conditions and minimal write load.
-- SECURITY DEFINER permits anonymous execution while maintaining strict RLS.
-- =============================================================================
CREATE OR REPLACE FUNCTION increment_views()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_views BIGINT;
BEGIN
  UPDATE salon_settings
  SET total_views = total_views + 1,
      updated_at = now()
  WHERE id = 1
  RETURNING total_views INTO v_updated_views;

  RETURN v_updated_views;
END;
$$;

-- Grant permissions for RPC execution
GRANT EXECUTE ON FUNCTION increment_views() TO anon;
GRANT EXECUTE ON FUNCTION increment_views() TO authenticated;
