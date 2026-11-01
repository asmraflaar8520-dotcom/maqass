// =============================================================================
// Maqass (مِقَصْ) — Super Admin Central Authority Hub (js/superadmin.js)
// Production Hardened: Platform Owner Metrics, Salon Lock Authority & Inspection
// =============================================================================

import {
  loginSuperAdmin,
  getSuperAdminSession,
  signOutSuperAdmin,
  getSuperAdminOverview,
  toggleSalonSuspension,
  getSalonAppointmentsAdmin
} from './api.js';
import {
  showToast,
  formatTime12H,
  formatDateArabic
} from './utils.js';

// Super Admin State
const state = {
  salons: [],
  metrics: null,
  currentFilter: 'all',
  searchQuery: ''
};

// DOM Cache
const DOM = {
  superGate: document.getElementById('super-gate'),
  superWrapper: document.getElementById('super-wrapper'),
  superAuthForm: document.getElementById('super-auth-form'),
  superEmail: document.getElementById('super-email'),
  superPassword: document.getElementById('super-password'),
  superErrorAlert: document.getElementById('super-error-alert'),
  superErrorText: document.getElementById('super-error-text'),
  btnSuperLogin: document.getElementById('btn-super-login'),
  btnSuperRefresh: document.getElementById('btn-super-refresh'),
  btnSuperLogout: document.getElementById('btn-super-logout'),

  // KPIs
  kpiTotalSalons: document.getElementById('kpi-total-salons'),
  kpiActiveSalons: document.getElementById('kpi-active-salons'),
  kpiSuspendedSalons: document.getElementById('kpi-suspended-salons'),
  kpiTotalBarbers: document.getElementById('kpi-total-barbers'),
  kpiTodayApps: document.getElementById('kpi-today-apps'),
  kpiTotalApps: document.getElementById('kpi-total-apps'),

  // Search & Filters
  inputSearchSalons: document.getElementById('input-search-salons'),
  filterPills: document.querySelectorAll('.filter-pill'),
  countAll: document.getElementById('count-all'),
  countActive: document.getElementById('count-active'),
  countSuspended: document.getElementById('count-suspended'),
  salonsTableBody: document.getElementById('salons-table-body'),

  // Modal Inspect
  modalInspect: document.getElementById('modal-inspect'),
  inspectSalonTitle: document.getElementById('inspect-salon-title'),
  inspectSalonSlug: document.getElementById('inspect-salon-slug'),
  inspectTableBody: document.getElementById('inspect-table-body'),
  btnCloseInspect: document.getElementById('btn-close-inspect')
};

/**
 * Initialize Super Admin Hub
 */
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  checkAuthAndBoot();
});

/**
 * Checks session authentication via Supabase Auth
 */
async function checkAuthAndBoot() {
  const hasSession = await getSuperAdminSession();
  if (hasSession) {
    unlockHub();
    await loadDashboardData();
  } else {
    DOM.superGate.style.display = 'flex';
    DOM.superWrapper.style.display = 'none';
    if (DOM.superEmail) DOM.superEmail.focus();
  }
}

/**
 * Unlocks the main dashboard interface
 */
function unlockHub() {
  DOM.superGate.style.display = 'none';
  DOM.superWrapper.style.display = 'block';
}

/**
 * Binds all interactive listeners
 */
function setupEventListeners() {
  // Login Form
  DOM.superAuthForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = DOM.superEmail.value.trim();
    const password = DOM.superPassword.value;
    if (!email || !password) return;

    DOM.btnSuperLogin.disabled = true;
    DOM.btnSuperLogin.innerHTML = 'جاري التحقق والاتصال الآمن... ⏳';
    if (DOM.superErrorAlert) DOM.superErrorAlert.style.display = 'none';

    try {
      await loginSuperAdmin({ email, password });
      unlockHub();
      await loadDashboardData();
      showToast('مرحباً بك يا مالك المنصة! تم الدخول بنجاح 👑', 'success');
    } catch (err) {
      if (DOM.superErrorAlert && DOM.superErrorText) {
        DOM.superErrorText.textContent = err.message || 'بيانات الدخول غير صحيحة.';
        DOM.superErrorAlert.style.display = 'flex';
      }
      showToast(err.message, 'error');
      DOM.superPassword.focus();
    } finally {
      DOM.btnSuperLogin.disabled = false;
      DOM.btnSuperLogin.innerHTML = 'دخول آمن للوحة المالك 🔐';
    }
  });

  // Refresh
  DOM.btnSuperRefresh.addEventListener('click', async () => {
    DOM.btnSuperRefresh.disabled = true;
    DOM.btnSuperRefresh.innerHTML = 'جاري التحديث... ⏳';
    await loadDashboardData();
    DOM.btnSuperRefresh.disabled = false;
    DOM.btnSuperRefresh.innerHTML = 'تحديث مباشر 🔄';
    showToast('تم تحديث البيانات بالكامل ✓', 'success');
  });

  // Logout
  DOM.btnSuperLogout.addEventListener('click', async () => {
    if (confirm('هل تريد تسجيل الخروج وقفل لوحة التحكم؟')) {
      await signOutSuperAdmin();
      window.location.reload();
    }
  });

  // Search input
  DOM.inputSearchSalons.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    renderSalonsTable();
  });

  // Filter Pills
  DOM.filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      DOM.filterPills.forEach(p => p.classList.remove('active-filter'));
      pill.classList.add('active-filter');
      state.currentFilter = pill.dataset.filter;
      renderSalonsTable();
    });
  });

  // Close Inspect Modal
  DOM.btnCloseInspect.addEventListener('click', () => {
    DOM.modalInspect.style.display = 'none';
  });

  DOM.modalInspect.addEventListener('click', (e) => {
    if (e.target === DOM.modalInspect) {
      DOM.modalInspect.style.display = 'none';
    }
  });
}

/**
 * Loads Platform Metrics & All Registered Salons
 */
async function loadDashboardData() {
  try {
    const data = await getSuperAdminOverview();
    state.salons = data.salons || [];
    state.metrics = data.metrics || {};

    updateMetricsDisplay();
    renderSalonsTable();
  } catch (err) {
    console.error('Super Admin load error:', err);
    throw err;
  }
}

/**
 * Updates KPI cards with loaded platform numbers
 */
function updateMetricsDisplay() {
  const m = state.metrics || {};
  DOM.kpiTotalSalons.textContent = (m.total_salons || 0).toLocaleString('ar-EG');
  DOM.kpiActiveSalons.textContent = (m.active_salons || 0).toLocaleString('ar-EG');
  DOM.kpiSuspendedSalons.textContent = (m.suspended_salons || 0).toLocaleString('ar-EG');
  DOM.kpiTotalBarbers.textContent = (m.total_barbers || 0).toLocaleString('ar-EG');
  DOM.kpiTodayApps.textContent = (m.today_appointments || 0).toLocaleString('ar-EG');
  DOM.kpiTotalApps.textContent = (m.total_appointments || 0).toLocaleString('ar-EG');

  // Filter pill badges
  DOM.countAll.textContent = state.salons.length;
  DOM.countActive.textContent = state.salons.filter(s => !s.is_suspended).length;
  DOM.countSuspended.textContent = state.salons.filter(s => !!s.is_suspended).length;
}

/**
 * Renders the Salons Table with filter and search applied
 */
function renderSalonsTable() {
  let list = [...state.salons];

  // Apply Filter
  if (state.currentFilter === 'active') {
    list = list.filter(s => !s.is_suspended);
  } else if (state.currentFilter === 'suspended') {
    list = list.filter(s => !!s.is_suspended);
  }

  // Apply Search
  if (state.searchQuery) {
    const q = state.searchQuery;
    list = list.filter(s => 
      (s.salon_name && s.salon_name.toLowerCase().includes(q)) ||
      (s.slug && s.slug.toLowerCase().includes(q)) ||
      (s.phone && s.phone.includes(q))
    );
  }

  DOM.salonsTableBody.innerHTML = '';

  if (list.length === 0) {
    DOM.salonsTableBody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 30px; color: var(--text-muted);">
          لا توجد صالونات مطابقة للبحث أو التصفية الحالية.
        </td>
      </tr>
    `;
    return;
  }

  list.forEach(salon => {
    const tr = document.createElement('tr');
    const isSuspended = !!salon.is_suspended;
    const cleanPhone = (salon.phone || '').replace(/\D/g, '');
    const waNumber = cleanPhone.startsWith('0') ? '2' + cleanPhone : cleanPhone;
    const waLink = `https://wa.me/${waNumber}`;

    tr.innerHTML = `
      <td>
        <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-primary); margin-bottom: 2px;">
          ${salon.salon_name}
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <code style="font-size: 0.75rem; color: var(--admin-accent); background: rgba(6,182,212,0.1); padding: 2px 6px; border-radius: 4px;">
            ${salon.slug}
          </code>
          <a href="index.html?s=${salon.slug}" target="_blank" style="color: var(--text-muted); font-size: 0.75rem; text-decoration: underline;" title="فتح صفحة الحجز المباشرة للزبائن">
            رابط الحجز ↗
          </a>
        </div>
      </td>

      <td>
        <div style="font-family: monospace; font-weight: 600; font-size: 0.88rem; direction: ltr; text-align: right;">
          ${salon.phone}
        </div>
        <a href="${waLink}" target="_blank" style="font-size: 0.75rem; color: #34d399; text-decoration: none; display: inline-flex; align-items: center; gap: 3px; margin-top: 2px;">
          💬 محادثة واتساب
        </a>
      </td>

      <td>
        <span class="badge" style="background: rgba(212, 175, 55, 0.15); color: var(--gold-primary); font-size: 0.8rem;">
          ✂️ ${salon.barbers_count || 1} كراسي
        </span>
        <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 3px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${salon.barber_names}">
          ${salon.barber_names || 'الحلاق الرئيسي'}
        </div>
      </td>

      <td>
        <span style="font-weight: 700; font-size: 1rem; font-family: 'Outfit', sans-serif;">
          ${(salon.appointments_count || 0).toLocaleString('ar-EG')}
        </span>
        <span style="font-size: 0.75rem; color: var(--text-muted);">حجز</span>
      </td>

      <td>
        ${isSuspended ? `
          <span class="badge badge-suspended" title="${salon.suspended_reason || 'مجمد بأمر الإدارة'}">
            🔒 مجمد / مقفول
          </span>
          ${salon.suspended_reason ? `<div style="font-size: 0.72rem; color: #f87171; margin-top: 3px;">${salon.suspended_reason}</div>` : ''}
        ` : `
          <span class="badge badge-live">
            🟢 نشط ومتاح
          </span>
          ${salon.is_paused ? '<div style="font-size: 0.72rem; color: var(--gold-light); margin-top: 2px;">(استراحة ذاتية ⏸️)</div>' : ''}
        `}
      </td>

      <td style="font-size: 0.8rem; color: var(--text-muted);">
        ${formatDateArabic(salon.created_at ? salon.created_at.split('T')[0] : '')}
      </td>

      <td>
        <div class="table-actions">
          ${isSuspended ? `
            <button class="btn-action-sm btn-unlock" data-action="unlock" data-id="${salon.id}" data-name="${salon.salon_name}">
              فك القفل 🟢
            </button>
          ` : `
            <button class="btn-action-sm btn-lock" data-action="lock" data-id="${salon.id}" data-name="${salon.salon_name}">
              قفل الصالون 🔒
            </button>
          `}
          <button class="btn-action-sm btn-inspect" data-action="inspect" data-id="${salon.id}" data-name="${salon.salon_name}" data-slug="${salon.slug}">
            فحص الحجوزات 📋
          </button>
        </div>
      </td>
    `;

    // Bind Lock / Unlock
    const lockBtn = tr.querySelector('[data-action="lock"]');
    if (lockBtn) {
      lockBtn.addEventListener('click', () => handleToggleLock(salon.id, salon.salon_name, true));
    }

    const unlockBtn = tr.querySelector('[data-action="unlock"]');
    if (unlockBtn) {
      unlockBtn.addEventListener('click', () => handleToggleLock(salon.id, salon.salon_name, false));
    }

    // Bind Inspect
    const inspectBtn = tr.querySelector('[data-action="inspect"]');
    if (inspectBtn) {
      inspectBtn.addEventListener('click', () => handleInspectSalon(salon.id, salon.salon_name, salon.slug));
    }

    DOM.salonsTableBody.appendChild(tr);
  });
}

/**
 * Handles toggling salon suspension (Locking or Unlocking)
 */
async function handleToggleLock(salonId, salonName, shouldSuspend) {
  let reason = null;
  if (shouldSuspend) {
    const input = prompt(`هل تريد بالتأكيد قفل وتجميد صالون (${salonName})؟\n\nأدخل سبب القفل (اختياري - يظهر للصالون):`, 'تأخر سداد الاشتراك الشهري');
    if (input === null) return; // user cancelled
    reason = input.trim() || 'معلق بأمر إدارة المنصة';
  } else {
    if (!confirm(`هل تريد بالتأكيد فك القفل وإعادة تفعيل صالون (${salonName}) فوراً؟`)) {
      return;
    }
  }

  try {
    showToast('جاري تحديث حالة القفل في قاعدة البيانات... ⏳', 'info');
    await toggleSalonSuspension({
      salonId,
      suspend: shouldSuspend,
      reason
    });

    showToast(shouldSuspend ? `تم قفل صالون (${salonName}) بنجاح 🔒` : `تم فك القفل وتفعيل صالون (${salonName}) بنجاح 🟢`, 'success');
    await loadDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/**
 * Handles inspecting a specific salon's appointments history
 */
async function handleInspectSalon(salonId, salonName, salonSlug) {
  DOM.inspectSalonTitle.textContent = `سجل حجوزات: ${salonName}`;
  DOM.inspectSalonSlug.textContent = `الرمز التعريفي: ${salonSlug}`;
  DOM.inspectTableBody.innerHTML = `
    <tr>
      <td colspan="5" style="text-align: center; padding: 24px; color: var(--text-muted);">
        جاري جلب تفاصيل الحجوزات... ⏳
      </td>
    </tr>
  `;
  DOM.modalInspect.style.display = 'flex';

  try {
    const apps = await getSalonAppointmentsAdmin(salonId);
    DOM.inspectTableBody.innerHTML = '';

    if (apps.length === 0) {
      DOM.inspectTableBody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 24px; color: var(--text-muted);">
            لا توجد حجوزات مسجلة لهذا الصالون حتى الآن.
          </td>
        </tr>
      `;
      return;
    }

    apps.forEach(app => {
      const row = document.createElement('tr');
      const serviceName = app.services?.name || 'خدمة عامة';
      const barberName = app.barbers?.name || 'أي حلاق متاح';
      const statusMap = {
        completed: '<span class="badge badge-completed">مكتمل ✓</span>',
        in_progress: '<span class="badge" style="background: rgba(212,175,55,0.2); color: var(--gold-primary);">على الكرسي ✂️</span>',
        pending: '<span class="badge badge-pending">قيد الانتظار ⏳</span>',
        cancelled: '<span class="badge badge-cancelled">ملغي ✕</span>',
        no_show: '<span class="badge badge-no-show">لم يحضر ⚠️</span>'
      };

      row.innerHTML = `
        <td>
          <div style="font-weight: 700;">${app.client_name}</div>
          <div style="font-family: monospace; font-size: 0.78rem; color: var(--text-muted);">${app.client_phone}</div>
        </td>
        <td>
          <span style="font-size: 0.85rem;">${serviceName}</span>
        </td>
        <td>
          <span style="font-size: 0.85rem; color: var(--gold-light);">💈 ${barberName}</span>
        </td>
        <td>
          <div style="font-size: 0.82rem;">${formatDateArabic(app.appointment_date)}</div>
          <div style="font-size: 0.78rem; color: var(--text-muted); direction: ltr; text-align: right;">${formatTime12H(app.appointment_time)}</div>
        </td>
        <td>
          ${statusMap[app.status] || app.status}
        </td>
      `;
      DOM.inspectTableBody.appendChild(row);
    });

  } catch (err) {
    DOM.inspectTableBody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 24px; color: #ef4444;">
          تعذر تحميل بيانات الحجوزات: ${err.message}
        </td>
      </tr>
    `;
  }
}
