// =============================================================================
// Maqass (مِقَصْ) — Centralized Data Access Layer (api.js)
// Production Hardened Edition: Strict RLS Auth, Timezone Safe, Walk-in Buffer Check
// & Automatic Zero-Setup Offline Demo Fallback for GitHub Pages
// =============================================================================

import { supabase, CONFIG } from './config.js';
import { 
  timeToMinutes, 
  minutesToTime, 
  formatTime12H,
  getEgyptLocalDate, 
  getEgyptLocalTimeMinutes 
} from './utils.js';

/**
 * Custom Error Class for Domain Errors with Arabic Messaging
 */
export class BookingError extends Error {
  constructor(message, code = 'BOOKING_ERROR') {
    super(message);
    this.name = 'BookingError';
    this.code = code;
  }
}

/**
 * Determines if application should run in Demo Mode (when Supabase is not configured yet)
 */
export function isDemoMode() {
  if (localStorage.getItem('MAQASS_DEMO_MODE') === 'true') return true;
  const isDefaultUrl = !CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.includes('YOUR_PROJECT_ID');
  const isDefaultKey = !CONFIG.SUPABASE_ANON_KEY || CONFIG.SUPABASE_ANON_KEY.includes('YOUR_SUPABASE_ANON_KEY');
  return isDefaultUrl || isDefaultKey;
}

// =============================================================================
// MOCK DATA STORE (For instant GitHub Pages preview without database setup)
// =============================================================================
const DEMO_STORE_KEY = 'maqass_demo_store_v1';

function getDemoStore() {
  let store = null;
  try {
    store = JSON.parse(localStorage.getItem(DEMO_STORE_KEY) || 'null');
  } catch {
    store = null;
  }

  if (!store) {
    const today = getEgyptLocalDate();
    store = {
      salon_settings: {
        id: 1,
        salon_name: 'صالون مِقَصْ للحلاقة',
        phone: '01012345678',
        working_hours: {
          "0": { "day_ar": "الأحد",     "open": "11:00", "close": "23:00", "is_off": false },
          "1": { "day_ar": "الإثنين",   "open": "11:00", "close": "23:00", "is_off": false },
          "2": { "day_ar": "الثلاثاء",  "open": "11:00", "close": "23:00", "is_off": false },
          "3": { "day_ar": "الأربعاء",  "open": "11:00", "close": "23:00", "is_off": false },
          "4": { "day_ar": "الخميس",   "open": "11:00", "close": "23:59", "is_off": false },
          "5": { "day_ar": "الجمعة",    "open": "13:30", "close": "23:59", "is_off": false },
          "6": { "day_ar": "السبت",    "open": "11:00", "close": "23:00", "is_off": false }
        },
        is_paused: false,
        total_views: 128
      },
      services: [
        { id: 'srv-1', name: 'قص شعر كلاسيكي / مودرن', price: 70, duration_minutes: 30, is_active: true },
        { id: 'srv-2', name: 'تحديد وتهذيب اللحية', price: 40, duration_minutes: 20, is_active: true },
        { id: 'srv-3', name: 'سشوار وتصفيف', price: 30, duration_minutes: 15, is_active: true },
        { id: 'srv-4', name: 'ماسك وصنفرة بشرة بالبخار', price: 60, duration_minutes: 25, is_active: true },
        { id: 'srv-5', name: 'باكيدج كامل (شعر + دقن + ماسك)', price: 150, duration_minutes: 60, is_active: true }
      ],
      appointments: [
        {
          id: 'app-demo-1',
          service_id: 'srv-1',
          client_name: 'كريم محمود',
          client_phone: '01011112222',
          appointment_date: today,
          start_time: '12:00:00',
          end_time: '12:30:00',
          status: 'completed',
          booking_type: 'online',
          services: { id: 'srv-1', name: 'قص شعر كلاسيكي / مودرن', duration_minutes: 30, price: 70 }
        },
        {
          id: 'app-demo-2',
          service_id: 'srv-2',
          client_name: 'طارق حسام',
          client_phone: '01122223333',
          appointment_date: today,
          start_time: '13:00:00',
          end_time: '13:20:00',
          status: 'in_progress',
          booking_type: 'online',
          services: { id: 'srv-2', name: 'تحديد وتهذيب اللحية', duration_minutes: 20, price: 40 }
        },
        {
          id: 'app-demo-3',
          service_id: 'srv-5',
          client_name: 'أحمد فؤاد',
          client_phone: '01233334444',
          appointment_date: today,
          start_time: '15:00:00',
          end_time: '16:00:00',
          status: 'pending',
          booking_type: 'online',
          services: { id: 'srv-5', name: 'باكيدج كامل (شعر + دقن + ماسك)', duration_minutes: 60, price: 150 }
        }
      ],
      blacklist: [
        { id: 'bl-1', client_phone: '01099998888', no_show_count: 2, is_blocked: true }
      ]
    };
    saveDemoStore(store);
  }
  return store;
}

function saveDemoStore(store) {
  try {
    localStorage.setItem(DEMO_STORE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage quota
  }
}

// =============================================================================
// 1. PUBLIC CLIENT APIS
// =============================================================================

/**
 * Fetches salon details and settings by slug, ID, or current logged-in owner
 * @param {string} [identifier] - Salon slug or UUID
 * @returns {Promise<Object>}
 */
export async function getSalonSettings(identifier = null) {
  if (isDemoMode()) {
    return getDemoStore().salon_settings;
  }

  try {
    let q = supabase.from('salons').select('*');

    if (identifier) {
      if (identifier.length === 36 && identifier.includes('-')) {
        q = q.eq('id', identifier);
      } else {
        q = q.eq('slug', identifier);
      }
    } else {
      // Check localStorage cached salon ID or session
      const cachedId = localStorage.getItem(CONFIG.STORAGE_KEYS.CURRENT_SALON_ID);
      const cachedSlug = localStorage.getItem(CONFIG.STORAGE_KEYS.CURRENT_SALON_SLUG);
      
      if (cachedId) {
        q = q.eq('id', cachedId);
      } else if (cachedSlug) {
        q = q.eq('slug', cachedSlug);
      } else {
        // Fallback to default/main or first salon
        q = q.eq('slug', 'main');
      }
    }

    const { data, error } = await q.maybeSingle();

    if (!error && data) {
      return data;
    }

    // Fallback: fetch first available salon or legacy salon_settings table
    const { data: firstSalon } = await supabase.from('salons').select('*').limit(1).maybeSingle();
    if (firstSalon) return firstSalon;

    const { data: legacy } = await supabase.from('salon_settings').select('*').eq('id', 1).maybeSingle();
    if (legacy) return legacy;

    return getDemoStore().salon_settings;
  } catch (err) {
    console.warn('getSalonSettings fallback:', err);
    return getDemoStore().salon_settings;
  }
}

export const getSalon = getSalonSettings;

/**
 * Fetches active barbers / chairs for a salon
 * @param {string} [salonId]
 * @returns {Promise<Array<Object>>}
 */
export async function getBarbers(salonId = null) {
  if (isDemoMode()) {
    return [
      { id: 'demo-barber-1', name: 'الأسطى أحمد', is_active: true },
      { id: 'demo-barber-2', name: 'الأسطى محمود', is_active: true }
    ];
  }

  try {
    let q = supabase
      .from('barbers')
      .select('id, salon_id, name, is_active, created_at')
      .eq('is_active', true);

    if (salonId) {
      q = q.eq('salon_id', salonId);
    }

    const { data, error } = await q.order('created_at', { ascending: true });

    if (!error && data && data.length > 0) {
      return data;
    }

    // Default barber fallback
    return [{ id: '00000000-0000-0000-0000-000000000002', name: 'الحلاق الرئيسي', is_active: true }];
  } catch (err) {
    console.warn('getBarbers warning:', err);
    return [{ id: 'default', name: 'الحلاق الرئيسي', is_active: true }];
  }
}

/**
 * Fetches active services catalog for client booking
 * @param {string} [salonId]
 * @returns {Promise<Array<Object>>}
 */
export async function getActiveServices(salonId = null) {
  if (isDemoMode()) {
    return getDemoStore().services.filter(s => s.is_active);
  }

  try {
    let q = supabase
      .from('services')
      .select('id, salon_id, name, price, duration_minutes, is_active')
      .eq('is_active', true);

    if (salonId) {
      q = q.eq('salon_id', salonId);
    }

    const { data, error } = await q.order('duration_minutes', { ascending: true });

    if (error) {
      console.error('Error fetching active services:', error);
      throw new BookingError('فشل في جلب قائمة الخدمات المتاحة.', error.code);
    }

    if (data && data.length > 0) return data;

    // Fallback: fetch services without salon_id filter
    const { data: fallbackServices } = await supabase
      .from('services')
      .select('id, salon_id, name, price, duration_minutes, is_active')
      .eq('is_active', true)
      .limit(5);

    return fallbackServices || [];
  } catch (err) {
    if (err instanceof BookingError) throw err;
    return getDemoStore().services.filter(s => s.is_active);
  }
}

/**
 * Fetches booked slots for a specific date (omits cancelled/no-show)
 * @param {string} date - "YYYY-MM-DD"
 * @param {string} [salonId]
 * @param {string} [barberId]
 * @returns {Promise<Array<Object>>}
 */
export async function getBookedSlots(date, salonId = null, barberId = null) {
  if (!date) return [];

  if (isDemoMode()) {
    const store = getDemoStore();
    return store.appointments
      .filter(a => a.appointment_date === date && !['cancelled', 'no_show'].includes(a.status))
      .map(a => ({ 
        id: a.id, 
        barber_id: a.barber_id || 'demo-barber-1',
        start_time: a.start_time, 
        end_time: a.end_time, 
        status: a.status 
      }));
  }

  try {
    let q = supabase
      .from('appointments')
      .select('id, salon_id, barber_id, start_time, end_time, status')
      .eq('appointment_date', date)
      .not('status', 'in', '("cancelled","no_show")');

    if (salonId) q = q.eq('salon_id', salonId);
    if (barberId && barberId !== 'any') q = q.eq('barber_id', barberId);

    const { data, error } = await q;

    if (error) {
      console.error('Error fetching booked slots:', error);
      throw new BookingError('فشل في جلب المواعيد المحجوزة لهذا اليوم.', error.code);
    }

    return data || [];
  } catch (err) {
    if (err instanceof BookingError) throw err;
    const store = getDemoStore();
    return store.appointments
      .filter(a => a.appointment_date === date && !['cancelled', 'no_show'].includes(a.status))
      .map(a => ({ id: a.id, start_time: a.start_time, end_time: a.end_time, status: a.status }));
  }
}

/**
 * Checks if a phone number is blocked on the blacklist
 * @param {string} rawPhone
 * @param {string} [salonId]
 * @returns {Promise<{ isBlocked: boolean, client: Object|null }>}
 */
export async function checkBlacklist(rawPhone, salonId = null) {
  if (!rawPhone) return { isBlocked: false, client: null };

  const sanitized = rawPhone.replace(/\s+/g, '').replace(/^(\+20|0020)/, '0');

  if (isDemoMode()) {
    const store = getDemoStore();
    const item = store.blacklist.find(b => b.client_phone === sanitized);
    return { isBlocked: !!(item && item.is_blocked), client: item || null };
  }

  try {
    let q = supabase
      .from('blacklist')
      .select('id, salon_id, client_phone, no_show_count, is_blocked')
      .eq('client_phone', sanitized);

    if (salonId) q = q.eq('salon_id', salonId);

    const { data, error } = await q.maybeSingle();

    if (error) {
      console.warn('Blacklist check warning:', error.message);
      return { isBlocked: false, client: null };
    }

    return { isBlocked: !!(data && data.is_blocked), client: data };
  } catch (err) {
    console.error('Error in checkBlacklist:', err);
    return { isBlocked: false, client: null };
  }
}

/**
 * Inserts a new client online booking
 * Catches PostgreSQL 23P01 (Exclusion Violation / Race Condition)
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export async function createAppointment(payload) {
  const sanitizedPhone = payload.client_phone.replace(/\s+/g, '').replace(/^(\+20|0020)/, '0');
  const startTime = payload.start_time.length === 5 ? `${payload.start_time}:00` : payload.start_time;
  const endTime = payload.end_time.length === 5 ? `${payload.end_time}:00` : payload.end_time;

  if (isDemoMode()) {
    const store = getDemoStore();
    const startMins = timeToMinutes(startTime);
    const endMins = timeToMinutes(endTime);

    const hasCollision = store.appointments.some(a => {
      if (a.appointment_date !== payload.appointment_date || ['cancelled', 'no_show'].includes(a.status)) {
        return false;
      }
      if (payload.barber_id && a.barber_id && a.barber_id !== payload.barber_id) {
        return false;
      }
      const bStart = timeToMinutes(a.start_time);
      const bEnd = timeToMinutes(a.end_time);
      return (startMins < bEnd && endMins > bStart);
    });

    if (hasCollision) {
      throw new BookingError(
        'عذراً، هذا الموعد تم حجزه للتو مع الحلاق المختار! يرجى اختيار موعد آخر.',
        'DOUBLE_BOOKING'
      );
    }

    const srv = store.services.find(s => s.id === payload.service_id) || { name: 'خدمة حلاقة', duration_minutes: 30, price: 70 };
    const newApp = {
      id: 'app-' + Date.now(),
      salon_id: payload.salon_id || 'demo-salon',
      barber_id: payload.barber_id || 'demo-barber-1',
      service_id: payload.service_id,
      client_name: payload.client_name.trim(),
      client_phone: sanitizedPhone,
      appointment_date: payload.appointment_date,
      start_time: startTime,
      end_time: endTime,
      status: 'pending',
      booking_type: payload.booking_type || 'online',
      created_at: new Date().toISOString(),
      services: srv,
      barbers: { name: payload.barber_name || 'الحلاق' }
    };

    store.appointments.push(newApp);
    saveDemoStore(store);
    return newApp;
  }

  const insertData = {
    salon_id: payload.salon_id || null,
    barber_id: (payload.barber_id && payload.barber_id !== 'any') ? payload.barber_id : null,
    service_id: payload.service_id,
    client_name: payload.client_name.trim(),
    client_phone: sanitizedPhone,
    appointment_date: payload.appointment_date,
    start_time: startTime,
    end_time: endTime,
    status: 'pending',
    booking_type: payload.booking_type || 'online'
  };

  try {
    const { data, error } = await supabase
      .from('appointments')
      .insert(insertData)
      .select(`
        id, 
        salon_id,
        barber_id,
        appointment_date, 
        start_time, 
        end_time, 
        status, 
        client_name, 
        client_phone, 
        service_id, 
        created_at,
        services ( name, duration_minutes, price ),
        barbers ( name )
      `)
      .single();

    if (error) {
      if (
        error.code === '23P01' || 
        error.message?.includes('no_double_booking') ||
        error.message?.includes('conflicting key value') ||
        error.message?.includes('exclusion')
      ) {
        throw new BookingError(
          'عذراً، هذا الموعد تم حجزه للتو مع الحلاق المختار! يرجى اختيار موعد أو حلاق آخر.',
          'DOUBLE_BOOKING'
        );
      }

      console.error('Database error creating appointment:', error);
      throw new BookingError(`حدث خطأ أثناء حفظ الحجز: ${error.message}`, error.code);
    }

    return data;
  } catch (err) {
    if (err instanceof BookingError) throw err;
    throw new BookingError('حدث خطأ غير متوقع أثناء تسجيل الحجز. يرجى إعادة المحاولة.');
  }
}

// =============================================================================
// 2. BARBER AUTHENTICATION & ACCESS CONTROL (SECURE AUTH HARDENED)
// =============================================================================

const ADMIN_PASSCODE_KEY = 'maqass_admin_authenticated';

/**
 * Signs in the barber/owner securely via authenticated credentials
 * Attaches valid JWT token to supabase client so hardened RLS policies pass
 * @param {string} email
 * @param {string} password
 * @returns {Promise<boolean>}
 */
export async function signInBarber(email, password = '') {
  if (isDemoMode()) {
    sessionStorage.setItem(ADMIN_PASSCODE_KEY, 'true');
    return { success: true };
  }

  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanPassword = (password || '').trim();

  if (!cleanEmail || !cleanPassword) {
    throw new BookingError('يرجى إدخال البريد الإلكتروني وكلمة المرور.');
  }

  // 1. Proactively try secure_barber_auth if RPC is available (auto-confirms & syncs)
  try {
    await supabase.rpc('secure_barber_auth', { p_email: cleanEmail, p_password: cleanPassword });
  } catch (_) {
    // Ignore if RPC not installed
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password: cleanPassword
    });

    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        throw new BookingError('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
      }
      if (error.message.includes('Email not confirmed')) {
        throw new BookingError('يرجى تأكيد بريدك الإلكتروني من الرابط المرسل إلى صندوق الوارد.');
      }
      throw new BookingError('تعذر تسجيل الدخول: ' + error.message);
    }

    if (data?.session) {
      sessionStorage.setItem(ADMIN_PASSCODE_KEY, 'true');

      // Pre-load and cache user's salon in localStorage
      const user = data.user;
      if (user) {
        const { data: salon } = await supabase
          .from('salons')
          .select('*')
          .eq('owner_id', user.id)
          .maybeSingle();

        if (salon) {
          localStorage.setItem(CONFIG.STORAGE_KEYS.CURRENT_SALON_ID, salon.id);
          localStorage.setItem(CONFIG.STORAGE_KEYS.CURRENT_SALON_SLUG, salon.slug);
        }
      }
      return { success: true };
    }
  } catch (err) {
    if (err instanceof BookingError) throw err;
    throw new BookingError('تعذر تسجيل الدخول، يرجى المحاولة مرة أخرى.');
  }

  throw new BookingError('بيانات الدخول غير صحيحة، يرجى التأكد من صحة الحساب.');
}

/**
 * Sends a password reset email to the barber
 * @param {string} email
 * @returns {Promise<Object>}
 */
export async function resetBarberPassword(email) {
  if (isDemoMode()) {
    return { success: true, message: 'في الوضع التجريبي يمكنك تسجيل الدخول بكلمة المرور: 123456' };
  }

  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanEmail) {
    throw new BookingError('يرجى إدخال البريد الإلكتروني لإرسال رابط الاستعادة.');
  }

  const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
    redirectTo: window.location.origin + window.location.pathname
  });

  if (error) {
    throw new BookingError('تعذر إرسال رابط الاستعادة: ' + error.message);
  }

  return { success: true };
}

/**
 * Checks if the barber currently has a valid authenticated session
 * @returns {Promise<boolean>}
 */
export async function getBarberSession() {
  if (isDemoMode()) {
    return sessionStorage.getItem(ADMIN_PASSCODE_KEY) === 'true';
  }

  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session) {
      sessionStorage.setItem(ADMIN_PASSCODE_KEY, 'true');
      return true;
    }
  } catch (err) {
    console.warn('Session check warning:', err);
  }

  return sessionStorage.getItem(ADMIN_PASSCODE_KEY) === 'true';
}

/**
 * Signs out the barber and clears session tokens
 */
export async function signOutBarber() {
  sessionStorage.removeItem(ADMIN_PASSCODE_KEY);
  localStorage.removeItem(CONFIG.STORAGE_KEYS.CURRENT_SALON_ID);
  localStorage.removeItem(CONFIG.STORAGE_KEYS.CURRENT_SALON_SLUG);
  try {
    await supabase.auth.signOut();
  } catch {
    // Ignore sign out error
  }
}

/**
 * Registers a new barber account, provisions their unique salon, chairs, and starter services.
 * Features smart seamless auth: if account already exists with matching password, logs them in directly.
 * @param {Object} payload - { email, password, salonName, phone, barberType, barberNames }
 * @returns {Promise<Object>} Created salon and barbers list
 */
export async function signUpNewSalon({ email, password, salonName, phone, barberType = 'single', barberNames = '' }) {
  if (isDemoMode()) {
    sessionStorage.setItem(ADMIN_PASSCODE_KEY, 'true');
    return { salon: getDemoStore().salon_settings, barbers: getDemoStore().barbers, isNew: true };
  }

  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanPassword = (password || '').trim();
  const cleanName = (salonName || '').trim() || 'صالون الحلاقة';
  const cleanPhone = (phone || '').trim().replace(/\s+/g, '').replace(/^(\+20|0020)/, '0');

  if (!cleanEmail || !cleanPassword) {
    throw new BookingError('يرجى إدخال البريد الإلكتروني وكلمة المرور.');
  }
  if (cleanPassword.length < 6) {
    throw new BookingError('يجب أن تكون كلمة المرور 6 أحرف أو أرقام على الأقل.');
  }

  // 1. Proactively try secure_barber_auth if RPC is available (auto-confirms & syncs password)
  try {
    await supabase.rpc('secure_barber_auth', { p_email: cleanEmail, p_password: cleanPassword });
  } catch (_) {
    // Ignore if RPC not installed
  }

  // 2. Attempt signUp in Supabase Auth
  let activeUser = null;
  let isExistingUser = false;

  const { data: authData, error: authErr } = await supabase.auth.signUp({
    email: cleanEmail,
    password: cleanPassword
  });

  if (authErr) {
    if (authErr.message.toLowerCase().includes('already registered')) {
      isExistingUser = true;
    } else {
      throw new BookingError('فشل إنشاء الحساب: ' + authErr.message);
    }
  } else if (authData?.user) {
    activeUser = authData.user;
    if (activeUser.identities && activeUser.identities.length === 0) {
      isExistingUser = true;
    }
  }

  // 3. Ensure an active session (call signInWithPassword if needed)
  if (!authData?.session) {
    const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password: cleanPassword
    });

    if (signInErr) {
      if (isExistingUser) {
        // Smart frictionless error: clean, brief, with error code for UI auto-tab switch
        const err = new BookingError('هذا البريد مسجل مسبقاً، تفضل بتسجيل الدخول بكلمة المرور الخاصة به.');
        err.code = 'EMAIL_ALREADY_EXISTS';
        err.email = cleanEmail;
        throw err;
      }
      if (signInErr.message.includes('Invalid login credentials')) {
        throw new BookingError('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
      }
      if (signInErr.message.includes('Email not confirmed')) {
        throw new BookingError('يرجى تأكيد بريدك الإلكتروني من الرابط المرسل إلى صندوق الوارد.');
      }
      throw new BookingError(signInErr.message);
    }

    if (signInData?.user) {
      activeUser = signInData.user;
    }
  }

  if (!activeUser) {
    throw new BookingError('تعذر إتمام تسجيل الحساب، يرجى المحاولة مرة أخرى.');
  }

  sessionStorage.setItem(ADMIN_PASSCODE_KEY, 'true');

  // 4. Check if this user already has an existing registered salon
  const { data: existingSalon } = await supabase
    .from('salons')
    .select('*')
    .eq('owner_id', activeUser.id)
    .maybeSingle();

  if (existingSalon) {
    localStorage.setItem(CONFIG.STORAGE_KEYS.CURRENT_SALON_ID, existingSalon.id);
    localStorage.setItem(CONFIG.STORAGE_KEYS.CURRENT_SALON_SLUG, existingSalon.slug);
    const existingBarbers = await getBarbers(existingSalon.id);
    return { 
      salon: existingSalon, 
      barbers: existingBarbers,
      isExistingLogin: true 
    };
  }

  // 5. Generate unique random slug & create Salon record
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const slug = 'salon-' + randomSuffix;

  const { data: salon, error: salonErr } = await supabase
    .from('salons')
    .insert({
      owner_id: activeUser.id,
      slug: slug,
      salon_name: cleanName,
      phone: cleanPhone || '01000000000',
      is_paused: false,
      total_views: 0
    })
    .select()
    .single();

  if (salonErr) {
    console.error('Error creating salon record:', salonErr);
    throw new BookingError('تم إنشاء الحساب ولكن تعذر تجهيز الصالون: ' + salonErr.message);
  }

  // 6. Create Barbers / Chairs
  let barbersToInsert = [];
  if (barberType === 'multi' && barberNames.trim()) {
    const names = barberNames.split(/[,،\n]/).map(n => n.trim()).filter(Boolean);
    if (names.length > 0) {
      barbersToInsert = names.map(name => ({
        salon_id: salon.id,
        name: name,
        is_active: true
      }));
    }
  }
  if (barbersToInsert.length === 0) {
    barbersToInsert = [{
      salon_id: salon.id,
      name: cleanName,
      is_active: true
    }];
  }

  const { data: createdBarbers, error: barberErr } = await supabase
    .from('barbers')
    .insert(barbersToInsert)
    .select();

  if (barberErr) {
    console.warn('Barber creation warning:', barberErr);
  }

  // 7. Create default initial services for this salon
  const defaultServices = [
    { salon_id: salon.id, name: 'قص شعر كلاسيكي / مودرن', price: 70, duration_minutes: 30, is_active: true },
    { salon_id: salon.id, name: 'تحديد وتهذيب اللحية', price: 40, duration_minutes: 20, is_active: true },
    { salon_id: salon.id, name: 'سشوار وتصفيف', price: 30, duration_minutes: 15, is_active: true },
    { salon_id: salon.id, name: 'ماسك وصنفرة بشرة بالبخار', price: 60, duration_minutes: 25, is_active: true },
    { salon_id: salon.id, name: 'باكيدج كامل (شعر + دقن + ماسك)', price: 150, duration_minutes: 60, is_active: true }
  ];

  await supabase.from('services').insert(defaultServices);

  // 8. Store active salon in localStorage
  localStorage.setItem(CONFIG.STORAGE_KEYS.CURRENT_SALON_ID, salon.id);
  localStorage.setItem(CONFIG.STORAGE_KEYS.CURRENT_SALON_SLUG, salon.slug);

  return { salon, barbers: createdBarbers || [], isNew: true };
}

/**
 * Fetches the salon owned by the currently logged-in barber
 * @returns {Promise<Object>}
 */
export async function getSalonForCurrentBarber() {
  if (isDemoMode()) {
    return getDemoStore().salon_settings;
  }

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const currentUserId = sessionData?.session?.user?.id;

    if (currentUserId) {
      const { data, error } = await supabase
        .from('salons')
        .select('*')
        .eq('owner_id', currentUserId)
        .maybeSingle();

      if (!error && data) {
        localStorage.setItem(CONFIG.STORAGE_KEYS.CURRENT_SALON_ID, data.id);
        localStorage.setItem(CONFIG.STORAGE_KEYS.CURRENT_SALON_SLUG, data.slug);
        return data;
      }
    }

    // Fallback: check localStorage cached ID
    const cachedId = localStorage.getItem(CONFIG.STORAGE_KEYS.CURRENT_SALON_ID);
    if (cachedId) {
      const { data } = await supabase.from('salons').select('*').eq('id', cachedId).maybeSingle();
      if (data) return data;
    }

    // Fallback: main salon
    const { data: mainSalon } = await supabase.from('salons').select('*').limit(1).maybeSingle();
    if (mainSalon) return mainSalon;

    const { data: legacy } = await supabase.from('salon_settings').select('*').eq('id', 1).maybeSingle();
    if (legacy) return legacy;

    return getDemoStore().salon_settings;
  } catch (err) {
    console.warn('getSalonForCurrentBarber fallback:', err);
    return getDemoStore().salon_settings;
  }
}

/**
 * Manages (creates or updates) a barber chair
 */
export async function manageBarber({ id = null, salonId, name, isActive = true }) {
  try {
    if (id) {
      const { data, error } = await supabase
        .from('barbers')
        .update({ name: name.trim(), is_active: isActive })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await supabase
        .from('barbers')
        .insert({ salon_id: salonId, name: name.trim(), is_active: isActive })
        .select()
        .single();
      if (error) throw error;
      return data;
    }
  } catch (err) {
    throw new BookingError('فشل في حفظ بيانات الحلاق: ' + err.message);
  }
}

/**
 * Deletes a barber chair
 */
export async function deleteBarber(barberId) {
  try {
    const { error } = await supabase
      .from('barbers')
      .delete()
      .eq('id', barberId);
    if (error) throw error;
    return true;
  } catch (err) {
    throw new BookingError('فشل في حذف الحلاق: ' + err.message);
  }
}

/**
 * Increments visitor counter for a salon
 */
export async function incrementSalonViews(salonId = null) {
  if (isDemoMode()) return null;
  const sessionKey = (CONFIG.STORAGE_KEYS.VIEW_RECORDED || 'maqass_view') + '_' + (salonId || 'main');
  if (sessionStorage.getItem(sessionKey)) return null;

  try {
    if (salonId) {
      const { data, error } = await supabase.rpc('increment_salon_views', { p_salon_id: salonId });
      if (!error && data !== null) {
        sessionStorage.setItem(sessionKey, 'true');
        return data;
      }
    }
    const { data, error } = await supabase.rpc('increment_views');
    if (!error && data !== null) {
      sessionStorage.setItem(sessionKey, 'true');
      return data;
    }
  } catch (err) {
    console.warn('increment views warning:', err);
  }
  return null;
}

// =============================================================================
// 3. BARBER DASHBOARD MANAGEMENT APIS
// =============================================================================

/**
 * 1-Tap Toggle for Salon Operational Break Status (is_paused)
 * @param {boolean} isPaused
 * @param {string} [salonId]
 * @returns {Promise<boolean>}
 */
export async function toggleSalonPause(isPaused, salonId = null) {
  const targetSalonId = salonId || localStorage.getItem(CONFIG.STORAGE_KEYS.CURRENT_SALON_ID);

  if (isDemoMode()) {
    const store = getDemoStore();
    store.salon_settings.is_paused = isPaused;
    saveDemoStore(store);
    return isPaused;
  }

  try {
    if (targetSalonId) {
      const { error } = await supabase
        .from('salons')
        .update({ is_paused: isPaused, updated_at: new Date().toISOString() })
        .eq('id', targetSalonId);

      if (error) throw error;
      return isPaused;
    }

    // Fallback: legacy salon_settings table
    const { error } = await supabase
      .from('salon_settings')
      .update({ is_paused: isPaused, updated_at: new Date().toISOString() })
      .eq('id', CONFIG.DEFAULT_SALON_ID);

    if (error) throw error;
    return isPaused;
  } catch (err) {
    console.error('Error toggling salon pause:', err);
    throw new BookingError('فشل في تغيير حالة عمل الصالون.');
  }
}

/**
 * Fetches all appointments for specified Egypt local date ordered by start_time
 * @param {string} date - "YYYY-MM-DD"
 * @param {string} [salonId]
 * @param {string} [barberId]
 * @returns {Promise<Array<Object>>}
 */
export async function getTodayAppointments(date, salonId = null, barberId = null) {
  const targetSalonId = salonId || localStorage.getItem(CONFIG.STORAGE_KEYS.CURRENT_SALON_ID);

  if (isDemoMode()) {
    const store = getDemoStore();
    return store.appointments
      .filter(a => a.appointment_date === date)
      .sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));
  }

  try {
    let q = supabase
      .from('appointments')
      .select(`
        id,
        salon_id,
        barber_id,
        service_id,
        client_name,
        client_phone,
        appointment_date,
        start_time,
        end_time,
        status,
        booking_type,
        created_at,
        services (
          id,
          name,
          duration_minutes,
          price
        ),
        barbers (
          id,
          name
        )
      `)
      .eq('appointment_date', date);

    if (targetSalonId) {
      q = q.eq('salon_id', targetSalonId);
    }
    if (barberId && barberId !== 'all') {
      q = q.eq('barber_id', barberId);
    }

    const { data, error } = await q.order('start_time', { ascending: true });

    if (error) {
      console.error('Error fetching today appointments:', error);
      throw new BookingError('فشل في جلب جدول مواعيد اليوم.');
    }

    return data || [];
  } catch (err) {
    if (err instanceof BookingError) throw err;
    const store = getDemoStore();
    return store.appointments.filter(a => a.appointment_date === date);
  }
}


/**
 * 1-Tap Update Appointment Status
 * Automatically increments no-show count and blocks phone on >= 2 no-shows
 * @param {string} id
 * @param {'in_progress'|'completed'|'no_show'|'cancelled'} status
 * @param {string} clientPhone
 * @returns {Promise<Object>}
 */
export async function updateAppointmentStatus(id, status, clientPhone = '') {
  if (isDemoMode()) {
    const store = getDemoStore();
    const app = store.appointments.find(a => a.id === id);
    if (app) {
      app.status = status;
      if (status === 'no_show' && clientPhone && clientPhone !== '01000000000') {
        const sanitized = clientPhone.replace(/\s+/g, '').replace(/^(\+20|0020)/, '0');
        const existing = store.blacklist.find(b => b.client_phone === sanitized);
        if (existing) {
          existing.no_show_count = (existing.no_show_count || 1) + 1;
          existing.is_blocked = existing.no_show_count >= 2;
        } else {
          store.blacklist.push({
            id: 'bl-' + Date.now(),
            client_phone: sanitized,
            no_show_count: 1,
            is_blocked: false
          });
        }
      }
      saveDemoStore(store);
      return app;
    }
    throw new BookingError('الموعد غير موجود.');
  }

  try {
    const { data, error } = await supabase
      .from('appointments')
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    if (status === 'no_show' && clientPhone && clientPhone !== '01000000000') {
      await handleNoShowBlacklist(clientPhone);
    }

    return data;
  } catch (err) {
    console.error('Error updating appointment status:', err);
    throw new BookingError('فشل في تحديث حالة الموعد. تأكد من تسجيل دخول الحلاق بصلاحيات كاملة.');
  }
}

/**
 * Auto-blacklisting handler
 */
async function handleNoShowBlacklist(rawPhone) {
  const sanitized = rawPhone.replace(/\s+/g, '').replace(/^(\+20|0020)/, '0');

  try {
    const { data: existing } = await supabase
      .from('blacklist')
      .select('id, no_show_count, is_blocked')
      .eq('client_phone', sanitized)
      .maybeSingle();

    if (existing) {
      const newCount = (existing.no_show_count || 1) + 1;
      const shouldBlock = newCount >= 2;

      await supabase
        .from('blacklist')
        .update({
          no_show_count: newCount,
          is_blocked: shouldBlock,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('blacklist')
        .insert({
          client_phone: sanitized,
          no_show_count: 1,
          is_blocked: false
        });
    }
  } catch (err) {
    console.warn('Auto-blacklist warning:', err);
  }
}

/**
 * 1-TAP WALK-IN APPOINTMENT CREATOR WITH TIME BUFFER CHECK
 * @param {string} serviceId
 * @param {boolean} [force=false]
 * @param {string} [salonId=null]
 * @param {string} [barberId=null]
 * @returns {Promise<Object>} Created appointment OR buffer warning object
 */
export async function addWalkInAppointment(serviceId, force = false, salonId = null, barberId = null) {
  const targetSalonId = salonId || localStorage.getItem(CONFIG.STORAGE_KEYS.CURRENT_SALON_ID);
  const todayEgypt = getEgyptLocalDate();
  const currentMins = getEgyptLocalTimeMinutes();
  let slotStart = Math.ceil(currentMins / 5) * 5;

  let service = null;
  if (isDemoMode()) {
    service = getDemoStore().services.find(s => s.id === serviceId);
  } else {
    try {
      const { data: sData } = await supabase
        .from('services')
        .select('id, name, duration_minutes, price')
        .eq('id', serviceId)
        .single();
      service = sData;
    } catch {
      service = getDemoStore().services.find(s => s.id === serviceId);
    }
  }

  if (!service) throw new Error('الخدمة المطلوبة غير موجودة');
  const duration = service.duration_minutes || 30;

  // Fetch booked slots for today
  const booked = await getBookedSlots(todayEgypt, targetSalonId, barberId);
  const activeIntervals = booked.map(b => ({
    start: timeToMinutes(b.start_time),
    end: timeToMinutes(b.end_time)
  }));

  // Buffer Check: find next upcoming active booking
  const upcomingBookings = booked
    .filter(b => timeToMinutes(b.start_time) > currentMins)
    .sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));

  if (upcomingBookings.length > 0 && !force) {
    const nextBooking = upcomingBookings[0];
    const nextStartMins = timeToMinutes(nextBooking.start_time);
    const remainingMinutes = nextStartMins - currentMins;

    if (remainingMinutes < duration && remainingMinutes > 0) {
      return {
        warning: true,
        remainingMinutes: remainingMinutes,
        nextAppointmentTime: formatTime12H(nextBooking.start_time),
        serviceName: service.name,
        durationMinutes: duration,
        serviceId: service.id,
        message: `تنبيه: متبقي ${remainingMinutes} دقيقة فقط حتى موعد الزبون القادم (${formatTime12H(nextBooking.start_time)})، بينما الخدمة تحتاج ${duration} دقيقة.`
      };
    }
  }

  // Find first collision-free slot
  let foundSlot = null;
  for (let testStart = slotStart; testStart + duration <= 1439; testStart += 5) {
    const testEnd = testStart + duration;
    const collides = activeIntervals.some(b => testStart < b.end && testEnd > b.start);
    if (!collides) {
      foundSlot = {
        start: minutesToTime(testStart),
        end: minutesToTime(testEnd)
      };
      break;
    }
  }

  if (!foundSlot) {
    throw new BookingError(`لا توجد خانة شاغرة اليوم تكفي خدمة مدتها ${duration} دقيقة دون تعارض.`);
  }

  if (isDemoMode()) {
    const store = getDemoStore();
    const newWalkIn = {
      id: 'app-walkin-' + Date.now(),
      service_id: service.id,
      client_name: 'زبون مباشر (Walk-in)',
      client_phone: '01000000000',
      appointment_date: todayEgypt,
      start_time: `${foundSlot.start}:00`,
      end_time: `${foundSlot.end}:00`,
      status: 'in_progress',
      booking_type: 'walk_in',
      created_at: new Date().toISOString(),
      services: service
    };
    store.appointments.push(newWalkIn);
    saveDemoStore(store);
    return newWalkIn;
  }

  try {
    const { data: walkIn, error: wErr } = await supabase
      .from('appointments')
      .insert({
        salon_id: targetSalonId || null,
        barber_id: (barberId && barberId !== 'any') ? barberId : null,
        service_id: service.id,
        client_name: 'زبون مباشر (Walk-in)',
        client_phone: '01000000000',
        appointment_date: todayEgypt,
        start_time: `${foundSlot.start}:00`,
        end_time: `${foundSlot.end}:00`,
        status: 'in_progress',
        booking_type: 'walk_in'
      })
      .select()
      .single();

    if (wErr) {
      if (wErr.code === '23P01') {
        throw new BookingError('الكرسي محجوز حالياً في هذا التوقيت لموعد آخر.');
      }
      throw wErr;
    }

    return walkIn;
  } catch (err) {
    if (err instanceof BookingError) throw err;
    throw new BookingError(err.message || 'فشل في إضافة زبون مباشر.');
  }
}

/**
 * Saves salon settings (name, phone, working hours)
 * @param {Object} settings
 * @returns {Promise<boolean>}
 */
export async function saveSalonSettings(settings, salonId = null) {
  const targetSalonId = salonId || localStorage.getItem(CONFIG.STORAGE_KEYS.CURRENT_SALON_ID);

  if (isDemoMode()) {
    const store = getDemoStore();
    store.salon_settings = { ...store.salon_settings, ...settings };
    saveDemoStore(store);
    return true;
  }

  try {
    if (targetSalonId) {
      const { error } = await supabase
        .from('salons')
        .update({
          salon_name: settings.salon_name,
          phone: settings.phone,
          working_hours: settings.working_hours,
          updated_at: new Date().toISOString()
        })
        .eq('id', targetSalonId);

      if (error) throw error;
      return true;
    }

    const { error } = await supabase
      .from('salon_settings')
      .update({
        salon_name: settings.salon_name,
        phone: settings.phone,
        working_hours: settings.working_hours,
        updated_at: new Date().toISOString()
      })
      .eq('id', CONFIG.DEFAULT_SALON_ID);

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('Error saving salon settings:', err);
    throw new BookingError('فشل في حفظ إعدادات الصالون.');
  }
}

/**
 * Fetches all services (active & inactive) for salon management
 * @param {string} [salonId]
 * @returns {Promise<Array<Object>>}
 */
export async function getAllServices(salonId = null) {
  const targetSalonId = salonId || localStorage.getItem(CONFIG.STORAGE_KEYS.CURRENT_SALON_ID);

  if (isDemoMode()) {
    return getDemoStore().services;
  }

  try {
    let q = supabase
      .from('services')
      .select('*');

    if (targetSalonId) {
      q = q.eq('salon_id', targetSalonId);
    }

    const { data, error } = await q.order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (err) {
    return getDemoStore().services;
  }
}

/**
 * Adds or updates a service
 * @param {Object} serviceData
 * @returns {Promise<Object>}
 */
export async function manageService(serviceData) {
  if (isDemoMode()) {
    const store = getDemoStore();
    if (serviceData.id) {
      const idx = store.services.findIndex(s => s.id === serviceData.id);
      if (idx !== -1) {
        store.services[idx] = {
          ...store.services[idx],
          name: serviceData.name,
          duration_minutes: parseInt(serviceData.duration_minutes, 10),
          price: parseFloat(serviceData.price || 0)
        };
        saveDemoStore(store);
        return store.services[idx];
      }
    } else {
      const newSrv = {
        id: 'srv-' + Date.now(),
        name: serviceData.name,
        duration_minutes: parseInt(serviceData.duration_minutes, 10),
        price: parseFloat(serviceData.price || 0),
        is_active: true
      };
      store.services.push(newSrv);
      saveDemoStore(store);
      return newSrv;
    }
  }

  try {
    const targetSalonId = salonId || serviceData.salon_id || localStorage.getItem(CONFIG.STORAGE_KEYS.CURRENT_SALON_ID);

    if (serviceData.id) {
      const { data, error } = await supabase
        .from('services')
        .update({
          name: serviceData.name,
          duration_minutes: parseInt(serviceData.duration_minutes, 10),
          price: parseFloat(serviceData.price || 0),
          is_active: serviceData.is_active
        })
        .eq('id', serviceData.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    } else {
      const { data, error } = await supabase
        .from('services')
        .insert({
          salon_id: targetSalonId || null,
          name: serviceData.name,
          duration_minutes: parseInt(serviceData.duration_minutes, 10),
          price: parseFloat(serviceData.price || 0),
          is_active: serviceData.is_active !== false
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    }
  } catch (err) {
    console.error('Error managing service:', err);
    throw new BookingError('فشل في حفظ بيانات الخدمة.');
  }
}

/**
 * Toggles a service active/inactive status
 * @param {string} id
 * @param {boolean} isActive
 * @returns {Promise<boolean>}
 */
export async function toggleServiceStatus(id, isActive) {
  if (isDemoMode()) {
    const store = getDemoStore();
    const s = store.services.find(item => item.id === id);
    if (s) {
      s.is_active = isActive;
      saveDemoStore(store);
      return isActive;
    }
  }

  try {
    const { error } = await supabase
      .from('services')
      .update({ is_active: isActive })
      .eq('id', id);

    if (error) throw error;
    return isActive;
  } catch (err) {
    console.error('Error toggling service status:', err);
    throw new BookingError('فشل في تغيير حالة الخدمة.');
  }
}

/**
 * Fetches all records from blacklist table
 * @returns {Promise<Array<Object>>}
 */
export async function getBlacklist() {
  if (isDemoMode()) {
    return getDemoStore().blacklist;
  }

  try {
    const { data, error } = await supabase
      .from('blacklist')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    return getDemoStore().blacklist;
  }
}

/**
 * Unblocks a client and resets no-show count to 0
 * @param {string} clientPhone
 * @returns {Promise<boolean>}
 */
export async function unblockClient(clientPhone) {
  const sanitized = clientPhone.replace(/\s+/g, '').replace(/^(\+20|0020)/, '0');

  if (isDemoMode()) {
    const store = getDemoStore();
    const b = store.blacklist.find(item => item.client_phone === sanitized);
    if (b) {
      b.is_blocked = false;
      b.no_show_count = 0;
      saveDemoStore(store);
      return true;
    }
  }

  try {
    const { error } = await supabase
      .from('blacklist')
      .update({
        is_blocked: false,
        no_show_count: 0,
        updated_at: new Date().toISOString()
      })
      .eq('client_phone', sanitized);

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('Error unblocking client:', err);
    throw new BookingError('فشل في فك حظر هذا الرقم.');
  }
}
