// =============================================================================
// Maqass (مِقَصْ) — Utility Functions & Business Logic Engine
// Zero-Dependency, Pure ES6 Browser Modules (Egypt Local Timezone Hardened)
// =============================================================================

import { CONFIG, supabase } from './config.js';

/**
 * Ultra-fast HTML sanitizer to prevent Cross-Site Scripting (XSS)
 * @param {string} str - Raw untrusted string
 * @returns {string} Sanitized HTML-safe string
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Returns the current date in Egypt local time ("YYYY-MM-DD")
 * Avoids naive `toISOString().split('T')[0]` which shifts date backwards past 10 PM.
 * @param {Date} [date] - Base date object (defaults to now)
 * @returns {string} Formatted local date string "YYYY-MM-DD"
 */
export function getEgyptLocalDate(date = new Date()) {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: CONFIG.TIMEZONE || 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(date);
  } catch {
    // Fallback using local device date
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}

/**
 * Returns current minutes from midnight in Egypt local time
 * @param {Date} [date] - Base date object (defaults to now)
 * @returns {number} Current minutes (0 - 1439)
 */
export function getEgyptLocalTimeMinutes(date = new Date()) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: CONFIG.TIMEZONE || 'Africa/Cairo',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    });
    const parts = formatter.formatToParts(date);
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    return (hour * 60) + minute;
  } catch {
    return (date.getHours() * 60) + date.getMinutes();
  }
}

/**
 * Converts a 24-hour time string ("HH:mm" or "HH:mm:ss") to total minutes from midnight
 * @param {string} timeStr - Example: "14:30"
 * @returns {number} Total minutes
 */
export function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  return (hours * 60) + minutes;
}

/**
 * Converts total minutes from midnight into a 24-hour "HH:mm" string
 * @param {number} totalMinutes
 * @returns {string} Example: "14:30"
 */
export function minutesToTime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const padH = String(hours).padStart(2, '0');
  const padM = String(minutes).padStart(2, '0');
  return `${padH}:${padM}`;
}

/**
 * Formats a 24-hour time string into Egyptian Arabic 12-hour format ("02:30 م")
 * @param {string} timeStr - Example: "14:30:00"
 * @returns {string} Example: "02:30 م"
 */
export function formatTime12H(timeStr) {
  if (!timeStr) return '';
  const totalMins = timeToMinutes(timeStr);
  let hours = Math.floor(totalMins / 60);
  const minutes = totalMins % 60;
  const period = hours >= 12 ? 'م' : 'ص';

  hours = hours % 12;
  if (hours === 0) hours = 12;

  const padH = String(hours).padStart(2, '0');
  const padM = String(minutes).padStart(2, '0');
  return `${padH}:${padM} ${period}`;
}

/**
 * Formats a YYYY-MM-DD date string into a friendly Arabic localized string
 * @param {string} dateStr - Example: "2026-11-01"
 * @returns {string} Example: "الأحد، 1 نوفمبر 2026"
 */
export function formatDateArabic(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr + 'T00:00:00');
  return new Intl.DateTimeFormat('ar-EG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

/**
 * Validates Egyptian Mobile Phone numbers (Vodafone, Orange, Etisalat, WE)
 * Matches: 010..., 011..., 012..., 015... (11 digits)
 * @param {string} phone
 * @returns {boolean}
 */
export function isValidEgyptianPhone(phone) {
  if (!phone) return false;
  const sanitized = phone.replace(/\s+/g, '').replace(/^(\+20|0020)/, '0');
  const regex = /^01[0125][0-9]{8}$/;
  return regex.test(sanitized);
}

/**
 * Normalizes phone numbers to Egyptian international format for WhatsApp (201xxxxxxxxx)
 * @param {string} phone
 * @returns {string}
 */
export function normalizePhoneForWhatsApp(phone) {
  if (!phone) return '';
  let cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('0020')) {
    cleaned = cleaned.substring(2);
  } else if (cleaned.startsWith('01') && cleaned.length === 11) {
    cleaned = '2' + cleaned;
  }
  return cleaned;
}

/**
 * TIME-SLOT CALCULATOR (Multi-Barber Capacity Aware)
 * Generates available appointment slots by subtracting active bookings from working hours.
 * Supports multiple chairs/barbers: a slot is available if at least 1 barber is free.
 * 
 * @param {Object} workingDaySchedule - { open: "11:00", close: "23:00", is_off: false }
 * @param {Array} bookedAppointments  - [{ start_time: "14:00", end_time: "14:30", barber_id: "...", status: "pending" }]
 * @param {number} serviceDurationMinutes - e.g. 30
 * @param {string} targetDate - "YYYY-MM-DD"
 * @param {Array} activeBarbers - [{ id: "...", name: "الأسطى أحمد" }]
 * @param {string} selectedBarberId - Specific barber UUID or 'any'
 * @returns {Array<Object>} List of available slot objects
 */
export function calculateAvailableSlots(
  workingDaySchedule,
  bookedAppointments = [],
  serviceDurationMinutes = 30,
  targetDate = null,
  activeBarbers = [],
  selectedBarberId = 'any'
) {
  if (!workingDaySchedule || workingDaySchedule.is_off) {
    return [];
  }

  const openMinutes = timeToMinutes(workingDaySchedule.open);
  let closeMinutes = timeToMinutes(workingDaySchedule.close);

  // Handle midnight crossing (e.g. opens 11:00 AM / 660 mins, closes 01:00 AM / 60 + 1440 = 1500 mins)
  if (closeMinutes <= openMinutes) {
    closeMinutes += 1440;
  }

  if (closeMinutes <= openMinutes) {
    return [];
  }

  // Pre-filter active appointments that occupy the chair
  const activeBookings = bookedAppointments
    .filter(app => !['cancelled', 'no_show'].includes(app.status))
    .map(app => ({
      barber_id: app.barber_id,
      start: timeToMinutes(app.start_time),
      end: timeToMinutes(app.end_time)
    }));

  // Determine current Egypt time in minutes if targetDate is today
  let currentDayMinutes = -1;
  const todayEgyptStr = getEgyptLocalDate();

  if (targetDate === todayEgyptStr) {
    currentDayMinutes = getEgyptLocalTimeMinutes() + 15; // 15-min preparation buffer
  }

  const availableSlots = [];
  const step = CONFIG.DEFAULT_SLOT_INTERVAL_MINUTES || 15;
  const barbersList = (activeBarbers && activeBarbers.length > 0) 
    ? activeBarbers 
    : [];

  if (barbersList.length === 0) {
    return [];
  }

  for (let slotStart = openMinutes; slotStart + serviceDurationMinutes <= closeMinutes; slotStart += step) {
    const slotEnd = slotStart + serviceDurationMinutes;

    // Filter out past slots for today
    if (currentDayMinutes !== -1 && slotStart < currentDayMinutes) {
      continue;
    }

    const normStart = slotStart >= 1440 ? slotStart - 1440 : slotStart;
    const normEnd = slotEnd >= 1440 ? slotEnd - 1440 : slotEnd;

    // Collision checker with normalized active bookings
    const collidesWith = (b) => {
      if (slotStart < 1440 && slotEnd <= 1440) {
        return (slotStart < b.end && slotEnd > b.start);
      }
      return (normStart < b.end && normEnd > b.start);
    };

    // Determine available barbers for this slot
    let availableBarber = null;

    if (selectedBarberId && selectedBarberId !== 'any') {
      // Specific barber chosen
      const isOccupied = activeBookings.some(b => 
        b.barber_id === selectedBarberId && collidesWith(b)
      );
      if (!isOccupied) {
        availableBarber = barbersList.find(b => b.id === selectedBarberId) || { id: selectedBarberId, name: 'الحلاق المختار' };
      }
    } else {
      // Any barber: Find first available barber for this slot
      availableBarber = barbersList.find(b => {
        return !activeBookings.some(app => 
          app.barber_id === b.id && collidesWith(app)
        );
      });
    }

    if (availableBarber) {
      const time24 = minutesToTime(normStart);
      const endTime24 = minutesToTime(normEnd);
      availableSlots.push({
        time: time24,
        endTime: endTime24,
        label: formatTime12H(time24),
        endLabel: formatTime12H(endTime24),
        startMinutes: slotStart,
        endMinutes: slotEnd,
        barberId: availableBarber.id,
        barberName: availableBarber.name
      });
    }
  }

  return availableSlots;
}

/**
 * WHATSAPP LINK GENERATOR (Egyptian Arabic)
 * Creates instant wa.me click-to-chat links with tailored Egyptian Arabic messages
 * 
 * @param {Object} details
 * @returns {string} Direct WhatsApp URL
 */
export function generateWhatsAppLink({
  clientPhone,
  clientName = '',
  salonName = 'مِقَصْ',
  serviceName = '',
  date = '',
  time = '',
  type = 'confirmation'
}) {
  const normalizedPhone = normalizePhoneForWhatsApp(clientPhone);
  const formattedTime = time ? formatTime12H(time) : '';
  const formattedDate = date ? formatDateArabic(date) : '';

  let message = '';

  switch (type) {
    case 'confirmation':
      message = 
`يا هلا يا ${clientName || 'حبيبنا'}! ✂️
تم تأكيد حجز موعدك بنجاح في *${salonName}*.

💈 *الخدمة:* ${serviceName}
📅 *اليوم:* ${formattedDate}
⏰ *الميعاد:* ${formattedTime}

📍 مستنينك تنورنا في ميعادك بالظبط عشان منأخركش.
لو حبيت تعتذر أو تعدل ميعادك كلمنا قبلها بوقت كافي.`;
      break;

    case 'reminder':
      message = 
`صباح الفل يا ${clientName}! 💈
تذكير بميعادك النهاردة في *${salonName}*:
⏰ الميعاد: ${formattedTime}
💈 الخدمة: ${serviceName}

مستنينك، نعيماً مقدماً! ✨`;
      break;

    case 'cancellation':
      message = 
`أهلاً يا ${clientName}، تم إلغاء موعدك في *${salonName}* ليوم ${formattedDate} (${formattedTime}).
تقدر تحجز ميعاد تاني في أي وقت يناسبك من خلال الرابط. نتشرف بيك دايمًا!`;
      break;

    case 'inquiry':
    default:
      message = `السلام عليكم، بخصوص الحجز في ${salonName}...`;
      break;
  }

  const encodedMessage = encodeURIComponent(message);
  return `https://wa.me/${normalizedPhone}?text=${encodedMessage}`;
}

/**
 * ATOMIC VISITOR COUNTER TRIGGER (Session-Guarded)
 * Prevents redundant writes to Supabase Free Tier by storing a flag in sessionStorage.
 * @returns {Promise<number|null>} Total views count or null
 */
export async function triggerVisitorCounter() {
  const sessionKey = CONFIG.STORAGE_KEYS.VIEW_RECORDED;

  if (sessionStorage.getItem(sessionKey)) {
    return null;
  }

  try {
    const { data, error } = await supabase.rpc('increment_views');
    if (!error) {
      sessionStorage.setItem(sessionKey, 'true');
      return data;
    } else {
      console.warn('Visitor counter RPC warning:', error.message);
      return null;
    }
  } catch (err) {
    console.error('Visitor counter error:', err);
    return null;
  }
}

/**
 * Lightweight Toast Notification (Pure DOM, zero external dependencies)
 * @param {string} message - Text to display
 * @param {'info'|'success'|'error'} type - Style variant
 * @param {number} duration - Milliseconds to stay visible
 */
export function showToast(message, type = 'info', duration = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(15px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => {
      toast.remove();
      if (container.children.length === 0) {
        container.remove();
      }
    }, 300);
  }, duration);
}
