// =============================================================================
// Maqass (مِقَصْ) — Global Config & Supabase Client Initialization
// Zero Build Step: Uses native ES6 Modules via CDN
// =============================================================================

// Supabase JS SDK imported via pre-bundled CDN ESM (Single HTTP request, Cloudflare Edge cached)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?bundle';

/**
 * Project Configuration
 * Priority: localStorage (dynamic user setup) -> window.ENV -> Hardcoded defaults
 */
export const CONFIG = {
  SUPABASE_URL: 
    localStorage.getItem('MAQASS_SUPABASE_URL') || 
    window.MAQASS_ENV?.SUPABASE_URL || 
    'https://gifeydqrizdhchpxyhvi.supabase.co',

  SUPABASE_ANON_KEY: 
    localStorage.getItem('MAQASS_SUPABASE_ANON_KEY') || 
    window.MAQASS_ENV?.SUPABASE_ANON_KEY || 
    'sb_publishable_UCFRtyp6_HUTC7650TztpQ_bjOX4Uhi',

  APP_NAME: 'مِقَصْ',
  TIMEZONE: 'Africa/Cairo',
  DEFAULT_SLOT_INTERVAL_MINUTES: 15, // Grid resolution for checking time slots
  MAX_DAYS_IN_ADVANCE: 7,            // Allow booking up to 7 days ahead
  DEFAULT_SALON_ID: 1,
  
  // Storage keys for local caching & session tracking
  STORAGE_KEYS: {
    USER_PHONE: 'maqass_client_phone',
    USER_NAME: 'maqass_client_name',
    AUTH_TOKEN: 'maqass_barber_session',
    VIEW_RECORDED: 'maqass_view_counted_session'
  }
};

/**
 * Initialize and export singleton Supabase client
 * Configured with localStorage auth persistence for seamless barber login
 */
export const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    storageKey: 'maqass_supabase_auth',
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

/**
 * Status Dictionary (Egyptian Arabic UI Localization & Styling Meta)
 */
export const APPOINTMENT_STATUS = {
  pending: {
    key: 'pending',
    label: 'في الانتظار',
    badgeClass: 'badge-pending',
    canCancel: true
  },
  in_progress: {
    key: 'in_progress',
    label: 'على الكرسي الآن',
    badgeClass: 'badge-in-progress',
    canCancel: false
  },
  completed: {
    key: 'completed',
    label: 'تم بنجاح',
    badgeClass: 'badge-completed',
    canCancel: false
  },
  no_show: {
    key: 'no_show',
    label: 'لم يحضر (غياب)',
    badgeClass: 'badge-no-show',
    canCancel: false
  },
  cancelled: {
    key: 'cancelled',
    label: 'ملغي',
    badgeClass: 'badge-cancelled',
    canCancel: false
  }
};

/**
 * Arabic Days Map (Matching JavaScript Date.getDay() 0=Sunday..6=Saturday)
 */
export const ARABIC_DAYS = [
  'الأحد',
  'الإثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت'
];
