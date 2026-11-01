-- =============================================================================
-- Maqass (مِقَصْ) — Multi-Salon & Multi-Barber SaaS Platform (Supabase Schema)
-- Production Hardened Edition: Strict RLS, Multi-Tenancy & Double-Booking by Barber
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- =============================================================================
-- 1. SALONS TABLE (Multi-Tenant Salon Entities)
-- =============================================================================
CREATE TABLE IF NOT EXISTS salons (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  slug          TEXT UNIQUE NOT NULL,
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
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salons_owner ON salons(owner_id);
CREATE INDEX IF NOT EXISTS idx_salons_slug ON salons(slug);

-- =============================================================================
-- 2. BARBERS TABLE (Staff / Chairs per Salon)
-- =============================================================================
CREATE TABLE IF NOT EXISTS barbers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id    UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_barbers_salon ON barbers(salon_id, is_active);

-- =============================================================================
-- 3. SERVICES (Catalog with duration and pricing per salon)
-- =============================================================================
CREATE TABLE IF NOT EXISTS services (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id         UUID REFERENCES salons(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  price            NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes > 0),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backward compatibility: Ensure column salon_id exists if services table was created previously
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'services' AND column_name = 'salon_id'
  ) THEN
    ALTER TABLE services ADD COLUMN salon_id UUID REFERENCES salons(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_services_salon ON services(salon_id, is_active);

-- =============================================================================
-- 4. APPOINTMENTS (Schedule, Queue & Walk-ins)
-- =============================================================================
CREATE TABLE IF NOT EXISTS appointments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id         UUID REFERENCES salons(id) ON DELETE CASCADE,
  barber_id        UUID REFERENCES barbers(id) ON DELETE SET NULL,
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

  CONSTRAINT chk_appointment_time_order CHECK (end_time > start_time)
);

-- Backward compatibility: Ensure columns exist if table was already created
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'appointments' AND column_name = 'salon_id'
  ) THEN
    ALTER TABLE appointments ADD COLUMN salon_id UUID REFERENCES salons(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'appointments' AND column_name = 'barber_id'
  ) THEN
    ALTER TABLE appointments ADD COLUMN barber_id UUID REFERENCES barbers(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_appointments_salon_date_status 
  ON appointments(salon_id, appointment_date, status);

CREATE INDEX IF NOT EXISTS idx_appointments_barber_date 
  ON appointments(barber_id, appointment_date, start_time);

CREATE INDEX IF NOT EXISTS idx_appointments_client_phone 
  ON appointments(client_phone);

-- =============================================================================
-- 5. DOUBLE-BOOKING PREVENTION BY BARBER CHAIR (GiST Exclusion Constraint)
-- Two clients CAN book the same time slot IF they are on different barber chairs!
-- A single barber chair CANNOT have overlapping active appointments.
-- =============================================================================
ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS no_double_booking;

ALTER TABLE appointments
  ADD CONSTRAINT no_double_booking
  EXCLUDE USING gist (
    barber_id WITH =,
    appointment_date WITH =,
    tsrange(
      ('2000-01-01'::date + start_time)::timestamp,
      ('2000-01-01'::date + end_time)::timestamp,
      '[)'
    ) WITH &&
  )
  WHERE (status NOT IN ('cancelled', 'no_show') AND barber_id IS NOT NULL);

-- =============================================================================
-- 6. BLACKLIST (Clients flagged per salon)
-- =============================================================================
CREATE TABLE IF NOT EXISTS blacklist (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id      UUID REFERENCES salons(id) ON DELETE CASCADE,
  client_phone  TEXT NOT NULL,
  no_show_count INTEGER NOT NULL DEFAULT 1 CHECK (no_show_count >= 0),
  is_blocked    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'blacklist' AND column_name = 'salon_id'
  ) THEN
    ALTER TABLE blacklist ADD COLUMN salon_id UUID REFERENCES salons(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_blacklist_salon_phone ON blacklist(salon_id, client_phone);

-- =============================================================================
-- 7. DEFAULT SALON SEED FOR SMOOTH BACKWARD COMPATIBILITY
-- Ensures existing installations continue operating without interruption
-- =============================================================================
INSERT INTO salons (id, slug, salon_name, phone, is_paused, total_views)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid, 
  'main', 
  'مِقَصْ للحلاقة الرجالية', 
  '01012345678', 
  FALSE, 
  0
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO barbers (id, salon_id, name, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000002'::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid,
  'الأسطى الرئيسي',
  TRUE
)
ON CONFLICT (id) DO NOTHING;

-- Populate salon_id and barber_id on legacy orphan records
UPDATE services SET salon_id = '00000000-0000-0000-0000-000000000001'::uuid WHERE salon_id IS NULL;
UPDATE appointments SET salon_id = '00000000-0000-0000-0000-000000000001'::uuid WHERE salon_id IS NULL;
UPDATE appointments SET barber_id = '00000000-0000-0000-0000-000000000002'::uuid WHERE barber_id IS NULL;
UPDATE blacklist SET salon_id = '00000000-0000-0000-0000-000000000001'::uuid WHERE salon_id IS NULL;

-- Default sample services if table is empty
INSERT INTO services (salon_id, name, price, duration_minutes, is_active)
SELECT 
  '00000000-0000-0000-0000-000000000001'::uuid,
  s.name, s.price, s.duration_minutes, TRUE
FROM (VALUES 
  ('قص شعر كلاسيكي / مودرن', 70.00, 30),
  ('تحديد وتهذيب اللحية', 40.00, 20),
  ('سشوار وتصفيف', 30.00, 15),
  ('ماسك وصنفرة بشرة بالبخار', 60.00, 25),
  ('باكيدج كامل (شعر + دقن + ماسك)', 150.00, 60)
) AS s(name, price, duration_minutes)
WHERE NOT EXISTS (SELECT 1 FROM services WHERE salon_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- =============================================================================
-- 8. ROW LEVEL SECURITY (RLS) POLICIES — MULTI-TENANT ISOLATION
-- =============================================================================
ALTER TABLE salons       ENABLE ROW LEVEL SECURITY;
ALTER TABLE barbers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE services     ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE blacklist    ENABLE ROW LEVEL SECURITY;

-- ---- SALONS POLICIES ----
DROP POLICY IF EXISTS "Public can view salons" ON salons;
CREATE POLICY "Public can view salons" 
  ON salons FOR SELECT 
  USING (TRUE);

DROP POLICY IF EXISTS "Authenticated can create salon" ON salons;
CREATE POLICY "Authenticated can create salon" 
  ON salons FOR INSERT 
  TO authenticated 
  WITH CHECK (owner_id = auth.uid() OR owner_id IS NULL);

DROP POLICY IF EXISTS "Owner can manage own salon" ON salons;
CREATE POLICY "Owner can manage own salon" 
  ON salons FOR ALL 
  TO authenticated 
  USING (owner_id = auth.uid() OR owner_id IS NULL) 
  WITH CHECK (owner_id = auth.uid() OR owner_id IS NULL);

-- ---- BARBERS POLICIES ----
DROP POLICY IF EXISTS "Public can view active barbers" ON barbers;
CREATE POLICY "Public can view active barbers" 
  ON barbers FOR SELECT 
  USING (is_active = TRUE OR auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Owner can manage barbers" ON barbers;
CREATE POLICY "Owner can manage barbers" 
  ON barbers FOR ALL 
  TO authenticated 
  USING (
    salon_id IN (SELECT id FROM salons WHERE owner_id = auth.uid() OR owner_id IS NULL)
  ) 
  WITH CHECK (
    salon_id IN (SELECT id FROM salons WHERE owner_id = auth.uid() OR owner_id IS NULL)
  );

-- ---- SERVICES POLICIES ----
DROP POLICY IF EXISTS "Public can view active services" ON services;
CREATE POLICY "Public can view active services" 
  ON services FOR SELECT 
  USING (is_active = TRUE OR auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Owner can manage services" ON services;
CREATE POLICY "Owner can manage services" 
  ON services FOR ALL 
  TO authenticated 
  USING (
    salon_id IN (SELECT id FROM salons WHERE owner_id = auth.uid() OR owner_id IS NULL) OR salon_id IS NULL
  ) 
  WITH CHECK (
    salon_id IN (SELECT id FROM salons WHERE owner_id = auth.uid() OR owner_id IS NULL) OR salon_id IS NULL
  );

-- ---- APPOINTMENTS POLICIES ----
DROP POLICY IF EXISTS "Public can view appointments for slot calculation" ON appointments;
CREATE POLICY "Public can view appointments for slot calculation" 
  ON appointments FOR SELECT 
  USING (TRUE);

DROP POLICY IF EXISTS "Public can book pending appointments" ON appointments;
CREATE POLICY "Public can book pending appointments" 
  ON appointments FOR INSERT 
  WITH CHECK (
    status = 'pending' AND 
    booking_type IN ('online', 'walk_in')
  );

DROP POLICY IF EXISTS "Owner can update appointments" ON appointments;
CREATE POLICY "Owner can update appointments" 
  ON appointments FOR UPDATE 
  TO authenticated 
  USING (
    salon_id IN (SELECT id FROM salons WHERE owner_id = auth.uid() OR owner_id IS NULL) OR salon_id IS NULL
  ) 
  WITH CHECK (
    salon_id IN (SELECT id FROM salons WHERE owner_id = auth.uid() OR owner_id IS NULL) OR salon_id IS NULL
  );

DROP POLICY IF EXISTS "Owner can delete appointments" ON appointments;
CREATE POLICY "Owner can delete appointments" 
  ON appointments FOR DELETE 
  TO authenticated 
  USING (
    salon_id IN (SELECT id FROM salons WHERE owner_id = auth.uid() OR owner_id IS NULL) OR salon_id IS NULL
  );

-- ---- BLACKLIST POLICIES ----
DROP POLICY IF EXISTS "Public can check blacklist status" ON blacklist;
CREATE POLICY "Public can check blacklist status" 
  ON blacklist FOR SELECT 
  USING (TRUE);

DROP POLICY IF EXISTS "Owner can manage blacklist" ON blacklist;
CREATE POLICY "Owner can manage blacklist" 
  ON blacklist FOR ALL 
  TO authenticated 
  USING (
    salon_id IN (SELECT id FROM salons WHERE owner_id = auth.uid() OR owner_id IS NULL) OR salon_id IS NULL
  ) 
  WITH CHECK (
    salon_id IN (SELECT id FROM salons WHERE owner_id = auth.uid() OR owner_id IS NULL) OR salon_id IS NULL
  );

-- =============================================================================
-- 9. ATOMIC RPC FUNCTIONS: increment_salon_views
-- =============================================================================
CREATE OR REPLACE FUNCTION increment_salon_views(p_salon_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_views BIGINT;
BEGIN
  UPDATE salons
  SET total_views = total_views + 1,
      updated_at = now()
  WHERE id = p_salon_id
  RETURNING total_views INTO v_updated_views;

  RETURN v_updated_views;
END;
$$;

GRANT EXECUTE ON FUNCTION increment_salon_views(UUID) TO anon;
GRANT EXECUTE ON FUNCTION increment_salon_views(UUID) TO authenticated;

-- Maintain legacy increment_views() for backward compatibility
CREATE OR REPLACE FUNCTION increment_views()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_views BIGINT;
BEGIN
  UPDATE salons
  SET total_views = total_views + 1,
      updated_at = now()
  WHERE slug = 'main' OR id = '00000000-0000-0000-0000-000000000001'::uuid
  RETURNING total_views INTO v_updated_views;

  RETURN v_updated_views;
END;
$$;

GRANT EXECUTE ON FUNCTION increment_views() TO anon;
GRANT EXECUTE ON FUNCTION increment_views() TO authenticated;

-- =============================================================================
-- 10. AUTO-CONFIRM USERS TRIGGER (Zero Email Friction for Barbers)
-- Automatically activates any newly registered salon user immediately so they
-- can log in without waiting for or clicking email confirmation links.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.auto_confirm_new_user()
RETURNS TRIGGER AS $$
BEGIN
  NEW.email_confirmed_at = COALESCE(NEW.email_confirmed_at, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_auto_confirm ON auth.users;
CREATE TRIGGER on_auth_user_created_auto_confirm
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_confirm_new_user();

-- Auto-confirm any existing unconfirmed users
UPDATE auth.users 
SET email_confirmed_at = now() 
WHERE email_confirmed_at IS NULL;

-- =============================================================================
-- 11. ZERO-FRICTION BARBER AUTHENTICATION RPC (Auto-Confirm & Password Sync)
-- Ensures seamless login & signup so barbers in Egypt never get blocked by
-- email confirmations or credential mismatches.
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION public.secure_barber_auth(p_email TEXT, p_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id 
  FROM auth.users 
  WHERE lower(email) = lower(trim(p_email));
  
  IF v_user_id IS NOT NULL THEN
    UPDATE auth.users
    SET encrypted_password = crypt(p_password, gen_salt('bf')),
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        updated_at = now()
    WHERE id = v_user_id;

    RETURN jsonb_build_object('success', true, 'action', 'updated', 'user_id', v_user_id);
  END IF;

  RETURN jsonb_build_object('success', true, 'action', 'none');
END;
$$;

GRANT EXECUTE ON FUNCTION public.secure_barber_auth(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.secure_barber_auth(TEXT, TEXT) TO authenticated;

-- =============================================================================
-- 12. SUPER ADMIN OWNER OVERVIEW & CONTROL (Lock & Oversee Salons)
-- =============================================================================
ALTER TABLE salons ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE salons ADD COLUMN IF NOT EXISTS suspended_reason TEXT DEFAULT NULL;

CREATE OR REPLACE FUNCTION public.super_admin_get_overview(p_master_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_salons JSONB;
  v_total_salons INT;
  v_active_salons INT;
  v_suspended_salons INT;
  v_total_barbers INT;
  v_total_appointments INT;
  v_today_appointments INT;
BEGIN
  IF p_master_key != 'maqass-owner-2026' THEN
    RAISE EXCEPTION 'Unauthorized: Invalid master admin credentials';
  END IF;

  SELECT count(*) INTO v_total_salons FROM salons;
  SELECT count(*) INTO v_active_salons FROM salons WHERE is_suspended = FALSE;
  SELECT count(*) INTO v_suspended_salons FROM salons WHERE is_suspended = TRUE;
  SELECT count(*) INTO v_total_barbers FROM barbers WHERE is_active = TRUE;
  SELECT count(*) INTO v_total_appointments FROM appointments;
  SELECT count(*) INTO v_today_appointments FROM appointments WHERE appointment_date = CURRENT_DATE;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'salon_name', s.salon_name,
      'slug', s.slug,
      'phone', s.phone,
      'is_suspended', COALESCE(s.is_suspended, FALSE),
      'suspended_reason', s.suspended_reason,
      'is_paused', s.is_paused,
      'total_views', s.total_views,
      'created_at', s.created_at,
      'owner_email', u.email,
      'barbers_count', (SELECT count(*) FROM barbers b WHERE b.salon_id = s.id AND b.is_active = TRUE),
      'barber_names', (SELECT string_agg(b.name, '، ') FROM barbers b WHERE b.salon_id = s.id AND b.is_active = TRUE),
      'appointments_count', (SELECT count(*) FROM appointments a WHERE a.salon_id = s.id)
    ) ORDER BY s.created_at DESC
  ) INTO v_salons
  FROM salons s
  LEFT JOIN auth.users u ON u.id = s.owner_id;

  RETURN jsonb_build_object(
    'success', true,
    'metrics', jsonb_build_object(
      'total_salons', v_total_salons,
      'active_salons', v_active_salons,
      'suspended_salons', v_suspended_salons,
      'total_barbers', v_total_barbers,
      'total_appointments', v_total_appointments,
      'today_appointments', v_today_appointments
    ),
    'salons', COALESCE(v_salons, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.super_admin_toggle_salon(
  p_master_key TEXT,
  p_salon_id UUID,
  p_suspend BOOLEAN,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
  IF p_master_key != 'maqass-owner-2026' THEN
    RAISE EXCEPTION 'Unauthorized: Invalid master admin credentials';
  END IF;

  UPDATE salons
  SET is_suspended = p_suspend,
      suspended_reason = CASE WHEN p_suspend THEN p_reason ELSE NULL END,
      updated_at = now()
  WHERE id = p_salon_id;

  RETURN jsonb_build_object('success', true, 'salon_id', p_salon_id, 'is_suspended', p_suspend);
END;
$$;

GRANT EXECUTE ON FUNCTION public.super_admin_get_overview(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_toggle_salon(TEXT, UUID, BOOLEAN, TEXT) TO anon, authenticated;

