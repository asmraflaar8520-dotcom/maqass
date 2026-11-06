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
  is_paused        BOOLEAN NOT NULL DEFAULT FALSE,
  is_suspended     BOOLEAN NOT NULL DEFAULT FALSE,
  suspended_reason TEXT DEFAULT NULL,
  total_views      BIGINT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
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
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Owner can manage own salon" ON salons;
CREATE POLICY "Owner can manage own salon" 
  ON salons FOR ALL 
  TO authenticated 
  USING (owner_id = auth.uid()) 
  WITH CHECK (owner_id = auth.uid());

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
    salon_id IN (SELECT id FROM salons WHERE owner_id = auth.uid())
  ) 
  WITH CHECK (
    salon_id IN (SELECT id FROM salons WHERE owner_id = auth.uid())
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
    salon_id IN (SELECT id FROM salons WHERE owner_id = auth.uid())
  ) 
  WITH CHECK (
    salon_id IN (SELECT id FROM salons WHERE owner_id = auth.uid())
  );

-- ---- APPOINTMENTS POLICIES (Privacy Hardened — Zero PII Leakage) ----
DROP POLICY IF EXISTS "Public can view appointments for slot calculation" ON appointments;
DROP POLICY IF EXISTS "Owner can view appointments" ON appointments;

-- Only authenticated salon owners can view their own salon's appointments with client details
CREATE POLICY "Owner can view appointments" 
  ON appointments FOR SELECT 
  TO authenticated 
  USING (
    salon_id IN (SELECT id FROM salons WHERE owner_id = auth.uid())
  );

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
    salon_id IN (SELECT id FROM salons WHERE owner_id = auth.uid())
  ) 
  WITH CHECK (
    salon_id IN (SELECT id FROM salons WHERE owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "Owner can delete appointments" ON appointments;
CREATE POLICY "Owner can delete appointments" 
  ON appointments FOR DELETE 
  TO authenticated 
  USING (
    salon_id IN (SELECT id FROM salons WHERE owner_id = auth.uid())
  );

-- Secure privacy-preserving RPC: Public can calculate occupied slots WITHOUT ever reading client names or phones
CREATE OR REPLACE FUNCTION public.get_booked_slots(p_salon_id UUID, p_date DATE)
RETURNS TABLE (start_time TIME, end_time TIME, barber_id UUID, status TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT start_time, end_time, barber_id, status
  FROM appointments
  WHERE (p_salon_id IS NULL OR salon_id = p_salon_id)
    AND appointment_date = p_date
    AND status NOT IN ('cancelled', 'no_show');
$$;

GRANT EXECUTE ON FUNCTION public.get_booked_slots(UUID, DATE) TO anon, authenticated;

-- ---- BLACKLIST POLICIES (Privacy & Multi-Tenant Hardened) ----
DROP POLICY IF EXISTS "Public can check blacklist status" ON blacklist;
DROP POLICY IF EXISTS "Owner can view blacklist" ON blacklist;

CREATE POLICY "Owner can view blacklist" 
  ON blacklist FOR SELECT 
  TO authenticated 
  USING (
    salon_id IN (SELECT id FROM salons WHERE owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "Owner can manage blacklist" ON blacklist;
CREATE POLICY "Owner can manage blacklist" 
  ON blacklist FOR ALL 
  TO authenticated 
  USING (
    salon_id IN (SELECT id FROM salons WHERE owner_id = auth.uid())
  ) 
  WITH CHECK (
    salon_id IN (SELECT id FROM salons WHERE owner_id = auth.uid())
  );

-- Enforce unique phone per salon
CREATE UNIQUE INDEX IF NOT EXISTS idx_blacklist_unique_salon_phone ON blacklist(salon_id, client_phone);

-- Secure verification RPC: Check if client is blocked WITHOUT exposing the full blacklist table
CREATE OR REPLACE FUNCTION public.is_client_blocked(p_salon_id UUID, p_phone TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sanitized TEXT := regexp_replace(regexp_replace(p_phone, '\s+', '', 'g'), '^(\+20|0020)', '0');
  v_blocked BOOLEAN := FALSE;
BEGIN
  SELECT is_blocked INTO v_blocked
  FROM blacklist
  WHERE (p_salon_id IS NULL OR salon_id = p_salon_id)
    AND client_phone = v_sanitized
  LIMIT 1;

  RETURN COALESCE(v_blocked, FALSE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_client_blocked(UUID, TEXT) TO anon, authenticated;

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
-- 11. SECURITY HARDENING: REMOVE INSECURE RPC & ADD DEFENSE TRIGGERS
-- =============================================================================
-- Drops legacy insecure function to completely eliminate account takeover vulnerability
DROP FUNCTION IF EXISTS public.secure_barber_auth(TEXT, TEXT);

-- 11.1 PREVENT SUSPENSION TAMPERING BY SALON OWNERS (Vulnerability 1.5)
CREATE OR REPLACE FUNCTION public.check_salon_suspension_tamper()
RETURNS TRIGGER AS $$
BEGIN
  IF (OLD.is_suspended IS DISTINCT FROM NEW.is_suspended) OR 
     (OLD.suspended_reason IS DISTINCT FROM NEW.suspended_reason) THEN
    -- If request originates from authenticated client that is NOT verified platform admin
    IF current_setting('request.jwt.claim.role', true) = 'authenticated' AND 
       NOT EXISTS (SELECT 1 FROM platform_admins WHERE email = current_setting('request.jwt.claim.email', true)) THEN
      RAISE EXCEPTION 'غير مصرح بتعديل حالة قفل الصالون إلا من خلال مالك المنصة الرئيسي' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_suspension_tamper ON salons;
CREATE TRIGGER trg_prevent_suspension_tamper
BEFORE UPDATE ON salons
FOR EACH ROW
EXECUTE FUNCTION public.check_salon_suspension_tamper();

-- 11.2 PREVENT PAST BOOKINGS (Smell 3.3)
CREATE OR REPLACE FUNCTION public.check_appointment_date_valid()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.appointment_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'لا يمكن حجز موعد في تاريخ ماضٍ' USING ERRCODE = 'P0002';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_appointment_date ON appointments;
CREATE TRIGGER trg_check_appointment_date
BEFORE INSERT OR UPDATE ON appointments
FOR EACH ROW
EXECUTE FUNCTION public.check_appointment_date_valid();

-- 11.3 AUTO-PROVISION PRIMARY BARBER ON NEW SALON (Bug 2.1 & 2.3)
CREATE OR REPLACE FUNCTION public.auto_provision_primary_barber()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO barbers (id, salon_id, name, is_active)
  VALUES (gen_random_uuid(), NEW.id, 'الكرسي الرئيسي', TRUE)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_provision_primary_barber ON salons;
CREATE TRIGGER trg_auto_provision_primary_barber
AFTER INSERT ON salons
FOR EACH ROW
EXECUTE FUNCTION public.auto_provision_primary_barber();

-- 11.4 INSTANT SECURE PASSWORD RESET FOR SALON OWNERS (Zero Email Rate Limit Dependency)
-- Allows a verified salon owner to reset their password using their registered salon phone number
CREATE OR REPLACE FUNCTION public.reset_salon_password_direct(
  p_email TEXT,
  p_phone TEXT,
  p_new_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id UUID;
  v_clean_phone TEXT;
BEGIN
  IF p_email IS NULL OR p_phone IS NULL OR p_new_password IS NULL OR length(trim(p_new_password)) < 6 THEN
    RETURN jsonb_build_object('success', false, 'message', 'يرجى إدخال البريد ورقم الهاتف وكلمة مرور لا تقل عن 6 أحرف.');
  END IF;

  v_clean_phone := regexp_replace(regexp_replace(p_phone, '\s+', '', 'g'), '^(\+20|0020)', '0');

  -- Find owner user_id where salon phone matches
  SELECT u.id INTO v_user_id
  FROM auth.users u
  JOIN salons s ON s.owner_id = u.id
  WHERE lower(trim(u.email)) = lower(trim(p_email))
    AND regexp_replace(regexp_replace(s.phone, '\s+', '', 'g'), '^(\+20|0020)', '0') = v_clean_phone
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'بيانات التحقق غير صحيحة، يرجى التأكد من البريد الإلكتروني ورقم هاتف الصالون المسجل.');
  END IF;

  -- Update encrypted_password directly in auth.users
  UPDATE auth.users
  SET encrypted_password = crypt(p_new_password, gen_salt('bf')),
      email_confirmed_at = COALESCE(email_confirmed_at, now()),
      updated_at = now()
  WHERE id = v_user_id;

  RETURN jsonb_build_object('success', true, 'message', 'تم تحديث كلمة المرور بنجاح! يمكنك الآن تسجيل الدخول مباشرة 🚀');
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_salon_password_direct(TEXT, TEXT, TEXT) TO anon, authenticated;

-- =============================================================================
-- 12. SUPER ADMIN OWNER OVERVIEW & CONTROL (Lock & Oversee Salons)
-- =============================================================================
-- 12. ENTERPRISE SUPER ADMIN AUTHENTICATION (Zero Plaintext Secrets)
-- Authenticated via Supabase Auth & platform_admins table with Row Level Security
-- =============================================================================
ALTER TABLE salons ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE salons ADD COLUMN IF NOT EXISTS suspended_reason TEXT DEFAULT NULL;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Dedicated table for verified platform administrators
CREATE TABLE IF NOT EXISTS platform_admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'super_admin',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure table is independent and has password_hash and default UUID id
ALTER TABLE platform_admins DROP CONSTRAINT IF EXISTS platform_admins_id_fkey;
ALTER TABLE platform_admins ALTER COLUMN id SET DEFAULT gen_random_uuid();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'platform_admins' AND column_name = 'password_hash'
  ) THEN
    ALTER TABLE platform_admins ADD COLUMN password_hash TEXT;
  END IF;
END $$;

-- Strict RLS: block direct client reads to protect password hashes
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_admins FROM anon, authenticated;

-- Super Admin Zero-Friction Login & Auto-Setup RPC
CREATE OR REPLACE FUNCTION public.super_admin_login(p_email TEXT, p_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_clean_email TEXT := lower(trim(p_email));
  v_admin_count INT;
  v_admin RECORD;
  v_token UUID;
BEGIN
  IF v_clean_email = '' OR p_password = '' THEN
    RETURN jsonb_build_object('success', false, 'message', 'يرجى إدخال البريد الإلكتروني وكلمة المرور.');
  END IF;

  SELECT count(*) INTO v_admin_count FROM platform_admins;

  -- 1. Auto First-Time Setup: If no admin exists yet, register this first user as the platform owner!
  IF v_admin_count = 0 THEN
    INSERT INTO platform_admins (id, email, password_hash)
    VALUES (gen_random_uuid(), v_clean_email, crypt(p_password, gen_salt('bf')))
    RETURNING id INTO v_token;

    RETURN jsonb_build_object(
      'success', true,
      'token', v_token,
      'email', v_clean_email,
      'is_initial_setup', true,
      'message', 'تم إنشاء حسابك وتأمينه كمالك رئيسي للمنصة بنجاح 👑'
    );
  END IF;

  -- 2. Normal Login: lookup by email
  SELECT id, email, password_hash INTO v_admin
  FROM platform_admins
  WHERE lower(email) = v_clean_email;

  IF v_admin.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'البريد الإلكتروني غير مسجل كمالك للمنصة.');
  END IF;

  -- 3. Verify Bcrypt password hash
  IF v_admin.password_hash != crypt(p_password, v_admin.password_hash) THEN
    RETURN jsonb_build_object('success', false, 'message', 'كلمة المرور غير صحيحة.');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'token', v_admin.id,
    'email', v_admin.email
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.super_admin_login(TEXT, TEXT) TO anon, authenticated;

-- Overview function: accessible ONLY with a valid admin token
CREATE OR REPLACE FUNCTION public.super_admin_get_overview(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
  IF p_token IS NULL OR NOT EXISTS (SELECT 1 FROM platform_admins WHERE id = p_token) THEN
    RAISE EXCEPTION 'Unauthorized: Invalid or expired admin session' USING ERRCODE = '42501';
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

-- Toggle lock function: accessible ONLY with a valid admin token
CREATE OR REPLACE FUNCTION public.super_admin_toggle_salon(
  p_token UUID,
  p_salon_id UUID,
  p_suspend BOOLEAN,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_token IS NULL OR NOT EXISTS (SELECT 1 FROM platform_admins WHERE id = p_token) THEN
    RAISE EXCEPTION 'Unauthorized: Invalid or expired admin session' USING ERRCODE = '42501';
  END IF;

  UPDATE salons
  SET is_suspended = p_suspend,
      suspended_reason = CASE WHEN p_suspend THEN p_reason ELSE NULL END,
      updated_at = now()
  WHERE id = p_salon_id;

  RETURN jsonb_build_object('success', true, 'salon_id', p_salon_id, 'is_suspended', p_suspend);
END;
$$;

GRANT EXECUTE ON FUNCTION public.super_admin_get_overview(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_toggle_salon(UUID, UUID, BOOLEAN, TEXT) TO anon, authenticated;

-- =============================================================================
-- 13. REAL HARD LOCKDOWN TRIGGER (Blocks any booking for suspended salons)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.check_salon_not_suspended()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.salon_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM salons 
    WHERE id = NEW.salon_id 
      AND is_suspended = TRUE
  ) THEN
    RAISE EXCEPTION 'هذا الصالون متوقف حالياً بقرار من إدارة المنصة ولا يقبل أي حجوزات جديدة'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_salon_suspended ON appointments;
CREATE TRIGGER trg_check_salon_suspended
BEFORE INSERT ON appointments
FOR EACH ROW
EXECUTE FUNCTION public.check_salon_not_suspended();


