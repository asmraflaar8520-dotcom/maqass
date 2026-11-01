// =============================================================================
// Maqass (مِقَصْ) — The Barber's One-Screen Control Hub Logic (dashboard.js)
// Production Hardened Edition: Strict RLS Auth, Timezone Safe & Walk-in Buffer Check
// =============================================================================

import { CONFIG, supabase, ARABIC_DAYS } from './config.js';
import {
  getSalonSettings,
  getTodayAppointments,
  updateAppointmentStatus,
  addWalkInAppointment,
  toggleSalonPause,
  saveSalonSettings,
  getAllServices,
  manageService,
  toggleServiceStatus,
  getBlacklist,
  unblockClient,
  signInBarber,
  signOutBarber,
  getBarberSession
} from './api.js';
import {
  formatTime12H,
  formatDateArabic,
  getEgyptLocalDate,
  generateWhatsAppLink,
  showToast
} from './utils.js';

// Application State
const state = {
  currentTab: 'tab-queue',
  selectedDate: getEgyptLocalDate(),
  salonSettings: null,
  todayAppointments: [],
  allServices: [],
  blacklist: [],
  realtimeChannel: null
};

// DOM Elements Cache
const DOM = {
  // Auth
  loginGate: document.getElementById('login-gate'),
  loginForm: document.getElementById('login-form'),
  loginEmail: document.getElementById('login-email'),
  loginPassword: document.getElementById('login-password'),
  dashboardWrapper: document.getElementById('dashboard-wrapper'),
  btnLogout: document.getElementById('btn-logout'),

  // Top Bar
  dashSalonName: document.getElementById('dash-salon-name'),
  dashViewsCount: document.getElementById('dash-views-count'),
  syncIndicator: document.getElementById('sync-indicator'),

  // Command Bar
  btnTogglePause: document.getElementById('btn-toggle-pause'),
  pauseBtnText: document.getElementById('pause-btn-text'),
  btnOpenWalkinModal: document.getElementById('btn-open-walkin-modal'),

  // Tabs
  tabBtns: document.querySelectorAll('.tab-btn'),
  tabContents: document.querySelectorAll('.tab-content'),

  // Tab 1: Queue
  queueDatePicker: document.getElementById('queue-date-picker'),
  btnTodayShortcut: document.getElementById('btn-today-shortcut'),
  queueSummaryTag: document.getElementById('queue-summary-tag'),
  queueCardsContainer: document.getElementById('queue-cards-container'),

  // Tab 2: Stats
  statCompleted: document.getElementById('stat-completed'),
  statPending: document.getElementById('stat-pending'),
  statNoshow: document.getElementById('stat-noshow'),
  statShowupRate: document.getElementById('stat-showup-rate'),
  servicesBreakdownList: document.getElementById('services-breakdown-list'),

  // Tab 3: Settings & Blacklist
  servicesManageList: document.getElementById('services-manage-list'),
  btnAddServiceModal: document.getElementById('btn-add-service-modal'),
  salonSettingsForm: document.getElementById('salon-settings-form'),
  settingSalonName: document.getElementById('setting-salon-name'),
  settingSalonPhone: document.getElementById('setting-salon-phone'),
  workingHoursInputs: document.getElementById('working-hours-inputs'),
  blacklistTableBody: document.getElementById('blacklist-table-body'),

  // Modals
  walkinModal: document.getElementById('walkin-modal'),
  btnCloseWalkinModal: document.getElementById('btn-close-walkin-modal'),
  walkinServicesGrid: document.getElementById('walkin-services-grid'),

  serviceModal: document.getElementById('service-modal'),
  serviceModalTitle: document.getElementById('service-modal-title'),
  btnCloseServiceModal: document.getElementById('btn-close-service-modal'),
  serviceForm: document.getElementById('service-form'),
  serviceIdInput: document.getElementById('service-id-input'),
  serviceNameInput: document.getElementById('service-name-input'),
  serviceDurationInput: document.getElementById('service-duration-input'),
  servicePriceInput: document.getElementById('service-price-input')
};

/**
 * Entry Point: Check Session & Boot Dashboard
 */
document.addEventListener('DOMContentLoaded', async () => {
  setupAuthEventListeners();

  const isAuthenticated = await getBarberSession();
  if (!isAuthenticated) {
    DOM.loginGate.style.display = 'grid';
    DOM.dashboardWrapper.style.display = 'none';
    return;
  }

  await bootDashboard();
});

/**
 * Boots Dashboard after Authentication
 */
async function bootDashboard() {
  DOM.loginGate.style.display = 'none';
  DOM.dashboardWrapper.style.display = 'block';

  // Set default date to Egypt Local Time
  DOM.queueDatePicker.value = state.selectedDate;

  // Initial Data Fetches
  await Promise.all([
    loadSalonHeaderAndSettings(),
    loadQueueData(true),
    loadServicesCatalog(),
    loadBlacklistData()
  ]);

  // Bind Listeners
  setupNavigationEventListeners();
  setupCommandBarEventListeners();
  setupModalEventListeners();

  // Initialize Free-Tier Realtime Sync for Today's Date
  setupRealtimeSubscription(state.selectedDate);

  // Tab-Visibility Auto-Sync
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadQueueData(false);
      loadSalonHeaderAndSettings();
    }
  });
}

/**
 * Authentication Form Listeners (Supabase Auth Email/Password + PIN)
 */
function setupAuthEventListeners() {
  DOM.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const credential = DOM.loginEmail.value.trim();
    const password = DOM.loginPassword ? DOM.loginPassword.value : '';

    if (!credential) {
      showToast('يرجى إدخال البريد الإلكتروني أو الرقم السري.', 'error');
      return;
    }

    try {
      await signInBarber(credential, password);
      showToast('تم تسجيل الدخول بنجاح! أهلاً بك يا كابتن ✂️', 'success');
      await bootDashboard();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  DOM.btnLogout.addEventListener('click', async () => {
    if (confirm('هل تريد بالتأكيد تسجيل الخروج من لوحة التحكم؟')) {
      await signOutBarber();
      window.location.reload();
    }
  });
}

/**
 * Loads Salon Settings and updates Header & Pause Button
 */
async function loadSalonHeaderAndSettings() {
  try {
    const settings = await getSalonSettings();
    state.salonSettings = settings;

    // Header info
    if (settings.salon_name) DOM.dashSalonName.textContent = settings.salon_name;
    if (settings.total_views) DOM.dashViewsCount.textContent = Number(settings.total_views).toLocaleString('ar-EG');

    // Update Pause Toggle Button UI
    updatePauseButtonUI(settings.is_paused);

    // Populate Tab 3 Form Inputs
    if (DOM.settingSalonName) DOM.settingSalonName.value = settings.salon_name || '';
    if (DOM.settingSalonPhone) DOM.settingSalonPhone.value = settings.phone || '';
    renderWorkingHoursEditor(settings.working_hours);

  } catch (err) {
    console.warn('Could not load salon settings:', err);
  }
}

/**
 * Updates UI of Giant Pause Mode Toggle Button
 */
function updatePauseButtonUI(isPaused) {
  if (isPaused) {
    DOM.btnTogglePause.classList.add('active-pause');
    DOM.pauseBtnText.textContent = 'الصالون متوقف (اضغط للاستئناف) 🟢';
  } else {
    DOM.btnTogglePause.classList.remove('active-pause');
    DOM.pauseBtnText.textContent = 'إيقاف الحجز مؤقتاً (استراحة) 🛑';
  }
}

/**
 * TAB 1: Loads and Renders Queue Timeline for Selected Date
 * @param {boolean} showLoading - whether to display loading spinner
 */
async function loadQueueData(showLoading = true) {
  if (showLoading) {
    DOM.queueCardsContainer.innerHTML = `
      <div class="empty-state">
        <div class="spinner" style="margin-inline: auto; margin-bottom: 10px;"></div>
        <p>جاري تحديث المواعيد...</p>
      </div>
    `;
  }

  try {
    const appointments = await getTodayAppointments(state.selectedDate);
    state.todayAppointments = appointments;

    renderQueueCards(appointments);
    updateOperationalMetrics(appointments);

  } catch (err) {
    DOM.queueCardsContainer.innerHTML = `
      <div class="empty-state">
        <p style="color: #ef4444;">${err.message}</p>
      </div>
    `;
  }
}

/**
 * Renders Queue Cards with 1-Tap Status Actions & WhatsApp Link
 */
function renderQueueCards(appointments) {
  if (appointments.length === 0) {
    DOM.queueCardsContainer.innerHTML = `
      <div class="empty-state card">
        <div class="empty-icon">🛋️</div>
        <h3 style="font-size: 1.1rem; color: var(--text-primary); margin-bottom: 6px;">لا توجد مواعيد مسجلة لهذا اليوم</h3>
        <p style="font-size: 0.85rem; color: var(--text-muted);">
          يمكنك إدخال زبون مباشر الآن عبر زر (+ زبون مباشر)، أو الانتظار للحجوزات الإلكترونية.
        </p>
      </div>
    `;
    DOM.queueSummaryTag.textContent = 'الطابور خالٍ اليوم';
    return;
  }

  const pending = appointments.filter(a => a.status === 'pending').length;
  const inProgress = appointments.filter(a => a.status === 'in_progress').length;
  const completed = appointments.filter(a => a.status === 'completed').length;

  DOM.queueSummaryTag.textContent = `${inProgress} على الكرسي • ${pending} في الانتظار • ${completed} تم الانتهاء`;
  DOM.queueCardsContainer.innerHTML = '';

  appointments.forEach(app => {
    const card = document.createElement('div');
    card.className = `queue-card status-${app.status}`;
    card.id = `card-${app.id}`;

    const serviceName = app.services?.name || 'خدمة حلاقة';
    const duration = app.services?.duration_minutes || 30;
    const price = app.services?.price || 0;
    const timeFormatted = `${formatTime12H(app.start_time)} - ${formatTime12H(app.end_time)}`;
    const isWalkIn = app.booking_type === 'walk_in';

    const whatsappUrl = generateWhatsAppLink({
      clientPhone: app.client_phone,
      clientName: app.client_name,
      salonName: state.salonSettings?.salon_name || CONFIG.APP_NAME,
      serviceName: serviceName,
      date: app.appointment_date,
      time: app.start_time,
      type: 'reminder'
    });

    let statusBadge = '<span class="badge badge-pending">في الانتظار</span>';
    if (app.status === 'in_progress') statusBadge = '<span class="badge badge-in-progress">على الكرسي الآن ✂️</span>';
    if (app.status === 'completed')   statusBadge = '<span class="badge badge-completed">تم الانتهاء ✓</span>';
    if (app.status === 'no_show')     statusBadge = '<span class="badge badge-no-show">لم يحضر (غياب) ✕</span>';
    if (app.status === 'cancelled')   statusBadge = '<span class="badge badge-cancelled">ملغي</span>';

    card.innerHTML = `
      <div class="queue-header">
        <div class="queue-client-name">
          <span>${app.client_name}</span>
          ${isWalkIn ? '<span class="badge" style="background: rgba(16,185,129,0.15); color: #34d399;">مباشر ⚡</span>' : '<span class="badge" style="background: rgba(59,130,246,0.15); color: #60a5fa;">أونلاين 🌐</span>'}
        </div>
        <div class="queue-time">${timeFormatted}</div>
      </div>

      <div class="queue-meta">
        <span>💈 ${serviceName} (${duration} دقيقة)</span>
        <span>💵 ${Number(price).toFixed(0)} ج.م (للعرض)</span>
        ${!isWalkIn ? `<a href="${whatsappUrl}" target="_blank" rel="noopener" class="badge" style="background: #25d366; color: #fff; text-decoration: none; padding: 3px 8px;" title="إرسال تذكير واتساب">💬 واتساب</a>` : ''}
        ${statusBadge}
      </div>

      <!-- Giant 1-Tap Status Actions -->
      <div class="queue-actions">
        <button class="btn-action btn-action-start" data-id="${app.id}" data-phone="${app.client_phone}" ${app.status === 'in_progress' ? 'disabled style="opacity: 0.4;"' : ''}>
          <span>✂️</span>
          <span>بدأ الحلاقة</span>
        </button>

        <button class="btn-action btn-action-done" data-id="${app.id}" data-phone="${app.client_phone}" ${app.status === 'completed' ? 'disabled style="opacity: 0.4;"' : ''}>
          <span>✓</span>
          <span>تم الانتهاء</span>
        </button>

        <button class="btn-action btn-action-noshow" data-id="${app.id}" data-phone="${app.client_phone}" ${app.status === 'no_show' ? 'disabled style="opacity: 0.4;"' : ''}>
          <span>✕</span>
          <span>لم يحضر</span>
        </button>
      </div>
    `;

    card.querySelector('.btn-action-start').addEventListener('click', () => handleStatusChange(app.id, 'in_progress', app.client_phone));
    card.querySelector('.btn-action-done').addEventListener('click', () => handleStatusChange(app.id, 'completed', app.client_phone));
    card.querySelector('.btn-action-noshow').addEventListener('click', () => {
      if (confirm(`تسجيل غياب للزبون (${app.client_name})؟ إذا كان ثاني غياب سيتم حظره تلقائياً من الحجز.`)) {
        handleStatusChange(app.id, 'no_show', app.client_phone);
      }
    });

    DOM.queueCardsContainer.appendChild(card);
  });
}

/**
 * 1-Tap Status Change Handler
 */
async function handleStatusChange(appointmentId, newStatus, clientPhone) {
  try {
    await updateAppointmentStatus(appointmentId, newStatus, clientPhone);
    
    const statusLabels = {
      in_progress: 'على الكرسي الآن',
      completed: 'تم الانتهاء بنجاح',
      no_show: 'تم تسجيل غياب (No-Show)'
    };

    showToast(`تم التحديث: ${statusLabels[newStatus] || newStatus}`, 'success');
    await loadQueueData(false);

    if (newStatus === 'no_show') {
      await loadBlacklistData();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/**
 * TAB 2: Updates Pure Operational Metrics (Zero Financial Tracking)
 */
function updateOperationalMetrics(appointments) {
  const completed = appointments.filter(a => a.status === 'completed').length;
  const pending = appointments.filter(a => ['pending', 'in_progress'].includes(a.status)).length;
  const noShow = appointments.filter(a => a.status === 'no_show').length;

  DOM.statCompleted.textContent = completed;
  DOM.statPending.textContent = pending;
  DOM.statNoshow.textContent = noShow;

  const totalDecided = completed + noShow;
  const showUpRate = totalDecided === 0 ? 100 : Math.round((completed / totalDecided) * 100);
  DOM.statShowupRate.textContent = `${showUpRate}%`;

  const serviceCounts = {};
  appointments.forEach(app => {
    const sName = app.services?.name || 'خدمة عامة';
    serviceCounts[sName] = (serviceCounts[sName] || 0) + 1;
  });

  DOM.servicesBreakdownList.innerHTML = '';
  const serviceEntries = Object.entries(serviceCounts);

  if (serviceEntries.length === 0) {
    DOM.servicesBreakdownList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">لا توجد خدمات منفذة حتى الآن اليوم.</p>';
    return;
  }

  serviceEntries.forEach(([name, count]) => {
    const item = document.createElement('div');
    item.style.display = 'flex';
    item.style.justifyContent = 'space-between';
    item.style.alignItems = 'center';
    item.style.padding = '8px 12px';
    item.style.background = 'rgba(255,255,255,0.03)';
    item.style.borderRadius = 'var(--radius-sm)';

    item.innerHTML = `
      <span style="font-weight: 600; font-size: 0.9rem;">${name}</span>
      <span class="badge" style="background: rgba(212,175,55,0.15); color: var(--gold-primary); font-size: 0.85rem;">${count} رؤوس ✂️</span>
    `;
    DOM.servicesBreakdownList.appendChild(item);
  });
}

/**
 * TAB 3: Loads and Renders Services Catalog
 */
async function loadServicesCatalog() {
  try {
    const services = await getAllServices();
    state.allServices = services;

    DOM.servicesManageList.innerHTML = '';
    services.forEach(s => {
      const row = document.createElement('div');
      row.className = 'service-manage-item';

      row.innerHTML = `
        <div>
          <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-primary);">${s.name}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted);">
            ⏱️ ${s.duration_minutes} دقيقة • 💵 ${Number(s.price).toFixed(0)} ج.م (للعرض)
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 12px;">
          <button class="btn btn-secondary btn-edit-service" data-id="${s.id}" style="width: auto; padding: 4px 10px; font-size: 0.8rem;">
            تعديل ✏️
          </button>
          
          <label class="switch" title="تفعيل / تعطيل الخدمة">
            <input type="checkbox" class="service-toggle" data-id="${s.id}" ${s.is_active ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
      `;

      row.querySelector('.btn-edit-service').addEventListener('click', () => openEditServiceModal(s));
      row.querySelector('.service-toggle').addEventListener('change', async (e) => {
        try {
          await toggleServiceStatus(s.id, e.target.checked);
          showToast(`تم ${e.target.checked ? 'تفعيل' : 'تعطيل'} خدمة (${s.name})`, 'success');
        } catch (err) {
          showToast(err.message, 'error');
          e.target.checked = !e.target.checked;
        }
      });

      DOM.servicesManageList.appendChild(row);
    });

    renderWalkInModalServices(services.filter(s => s.is_active));

  } catch (err) {
    console.warn('Error loading services:', err);
  }
}

/**
 * Renders 1-Tap Services in Walk-In Modal with Time Buffer Edge-Case Check
 */
function renderWalkInModalServices(activeServices) {
  DOM.walkinServicesGrid.innerHTML = '';
  activeServices.forEach(s => {
    const btn = document.createElement('div');
    btn.className = 'service-card';
    btn.innerHTML = `
      <div class="service-name">${s.name}</div>
      <div class="service-meta">
        <span>⏱️ ${s.duration_minutes} دقيقة</span>
        <span class="service-price">${Number(s.price).toFixed(0)} ج.م</span>
      </div>
    `;

    btn.addEventListener('click', async () => {
      try {
        const result = await addWalkInAppointment(s.id, false);

        // Check if Buffer Warning is returned
        if (result && result.warning) {
          const confirmForce = confirm(
            `${result.message}\n\nهل تريد قفل الكرسي لزبون مباشر وبدء الحلاقة على أي حال؟`
          );

          if (!confirmForce) {
            return;
          }

          // Force lock chair
          await addWalkInAppointment(s.id, true);
        }

        DOM.walkinModal.style.display = 'none';
        showToast(`تم قفل الكرسي لزبون مباشر (${s.name}) بنجاح! ⚡`, 'success');
        await loadQueueData(false);

      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    DOM.walkinServicesGrid.appendChild(btn);
  });
}

/**
 * TAB 3: Loads and Renders Blacklist Table
 */
async function loadBlacklistData() {
  try {
    const blacklist = await getBlacklist();
    state.blacklist = blacklist;

    DOM.blacklistTableBody.innerHTML = '';

    if (blacklist.length === 0) {
      DOM.blacklistTableBody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 24px;">
            لا توجد أرقام مسجلة في القائمة السوداء حالياً.
          </td>
        </tr>
      `;
      return;
    }

    blacklist.forEach(b => {
      const tr = document.createElement('tr');
      const isBlocked = b.is_blocked;

      tr.innerHTML = `
        <td style="font-family: monospace; font-weight: 700;">${b.client_phone}</td>
        <td><span class="badge badge-no-show">${b.no_show_count} مرات غياب</span></td>
        <td>
          ${isBlocked 
            ? '<span class="badge badge-cancelled">محظور تماماً 🛑</span>' 
            : '<span class="badge badge-pending">تحذير (متبقي فرصة) ⚠️</span>'}
        </td>
        <td>
          <button class="btn btn-secondary btn-unblock" data-phone="${b.client_phone}" style="width: auto; padding: 4px 10px; font-size: 0.78rem;">
            فك الحظر ✓
          </button>
        </td>
      `;

      tr.querySelector('.btn-unblock').addEventListener('click', async () => {
        if (confirm(`فك حظر الرقم (${b.client_phone}) وإعادته للقائمة البيضاء؟`)) {
          try {
            await unblockClient(b.client_phone);
            showToast(`تم فك الحظر عن الرقم ${b.client_phone}`, 'success');
            await loadBlacklistData();
          } catch (err) {
            showToast(err.message, 'error');
          }
        }
      });

      DOM.blacklistTableBody.appendChild(tr);
    });

  } catch (err) {
    console.warn('Error loading blacklist:', err);
  }
}

/**
 * TAB 3: Generates Working Hours Inputs
 */
function renderWorkingHoursEditor(workingHours) {
  const hours = workingHours || {};
  DOM.workingHoursInputs.innerHTML = '';

  for (let i = 0; i < 7; i++) {
    const dayKey = String(i);
    const dayData = hours[dayKey] || { open: '11:00', close: '23:00', is_off: false };
    const dayName = ARABIC_DAYS[i];

    const row = document.createElement('div');
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '80px 1fr 1fr 70px';
    row.style.gap = '8px';
    row.style.alignItems = 'center';

    row.innerHTML = `
      <span style="font-weight: 700; font-size: 0.85rem;">${dayName}</span>
      <input type="time" class="form-control day-open" data-day="${dayKey}" value="${dayData.open}" style="padding: 6px 8px;">
      <input type="time" class="form-control day-close" data-day="${dayKey}" value="${dayData.close}" style="padding: 6px 8px;">
      <label style="font-size: 0.75rem; display: flex; align-items: center; gap: 4px; cursor: pointer;">
        <input type="checkbox" class="day-off" data-day="${dayKey}" ${dayData.is_off ? 'checked' : ''}>
        <span>إجازة</span>
      </label>
    `;

    DOM.workingHoursInputs.appendChild(row);
  }
}

/**
 * Opens Edit Service Modal
 */
function openEditServiceModal(service = null) {
  if (service) {
    DOM.serviceModalTitle.textContent = 'تعديل بيانات الخدمة';
    DOM.serviceIdInput.value = service.id;
    DOM.serviceNameInput.value = service.name;
    DOM.serviceDurationInput.value = service.duration_minutes;
    DOM.servicePriceInput.value = service.price;
  } else {
    DOM.serviceModalTitle.textContent = 'إضافة خدمة جديدة';
    DOM.serviceIdInput.value = '';
    DOM.serviceNameInput.value = '';
    DOM.serviceDurationInput.value = '30';
    DOM.servicePriceInput.value = '70';
  }
  DOM.serviceModal.style.display = 'grid';
}

/**
 * Free-Tier Realtime Subscription for Selected Date
 */
function setupRealtimeSubscription(date) {
  if (state.realtimeChannel) {
    supabase.removeChannel(state.realtimeChannel);
    state.realtimeChannel = null;
  }

  state.realtimeChannel = supabase
    .channel(`appointments-${date}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'appointments',
        filter: `appointment_date=eq.${date}`
      },
      () => {
        loadQueueData(false);
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        DOM.syncIndicator.style.display = 'inline-flex';
      }
    });
}

/**
 * Top Command Bar Listeners (Pause Toggle & Walk-in Modal)
 */
function setupCommandBarEventListeners() {
  DOM.btnTogglePause.addEventListener('click', async () => {
    const currentPaused = state.salonSettings?.is_paused || false;
    const newPaused = !currentPaused;

    DOM.btnTogglePause.disabled = true;
    try {
      await toggleSalonPause(newPaused);
      state.salonSettings.is_paused = newPaused;
      updatePauseButtonUI(newPaused);
      showToast(newPaused ? 'تم إيقاف الحجز مؤقتاً (استراحة) 🛑' : 'تم استئناف استقبال الحجوزات 🟢', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      DOM.btnTogglePause.disabled = false;
    }
  });

  DOM.btnOpenWalkinModal.addEventListener('click', () => {
    DOM.walkinModal.style.display = 'grid';
  });
}

/**
 * Tab Navigation & Date Listeners
 */
function setupNavigationEventListeners() {
  DOM.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;
      state.currentTab = targetTab;

      DOM.tabBtns.forEach(b => b.classList.remove('active'));
      DOM.tabContents.forEach(c => c.style.display = 'none');

      btn.classList.add('active');
      const activeContent = document.getElementById(targetTab);
      if (activeContent) activeContent.style.display = 'block';

      if (targetTab === 'tab-stats') {
        updateOperationalMetrics(state.todayAppointments);
      }
    });
  });

  DOM.queueDatePicker.addEventListener('change', async (e) => {
    state.selectedDate = e.target.value;
    setupRealtimeSubscription(state.selectedDate);
    await loadQueueData(true);
  });

  DOM.btnTodayShortcut.addEventListener('click', async () => {
    const today = getEgyptLocalDate();
    DOM.queueDatePicker.value = today;
    state.selectedDate = today;
    setupRealtimeSubscription(today);
    await loadQueueData(true);
  });
}

/**
 * Modal and Form Listeners
 */
function setupModalEventListeners() {
  DOM.btnCloseWalkinModal.addEventListener('click', () => {
    DOM.walkinModal.style.display = 'none';
  });

  DOM.btnAddServiceModal.addEventListener('click', () => openEditServiceModal(null));
  DOM.btnCloseServiceModal.addEventListener('click', () => {
    DOM.serviceModal.style.display = 'none';
  });

  DOM.serviceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const serviceData = {
      id: DOM.serviceIdInput.value || undefined,
      name: DOM.serviceNameInput.value.trim(),
      duration_minutes: parseInt(DOM.serviceDurationInput.value, 10),
      price: parseFloat(DOM.servicePriceInput.value || 0),
      is_active: true
    };

    try {
      await manageService(serviceData);
      showToast('تم حفظ الخدمة بنجاح ✨', 'success');
      DOM.serviceModal.style.display = 'none';
      await loadServicesCatalog();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  DOM.salonSettingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const newWorkingHours = {};
    const dayOpens = document.querySelectorAll('.day-open');
    const dayCloses = document.querySelectorAll('.day-close');
    const dayOffs = document.querySelectorAll('.day-off');

    dayOpens.forEach((input, idx) => {
      const dayKey = input.dataset.day;
      newWorkingHours[dayKey] = {
        day_ar: ARABIC_DAYS[parseInt(dayKey, 10)],
        open: input.value,
        close: dayCloses[idx].value,
        is_off: dayOffs[idx].checked
      };
    });

    const updatedSettings = {
      salon_name: DOM.settingSalonName.value.trim(),
      phone: DOM.settingSalonPhone.value.trim(),
      working_hours: newWorkingHours
    };

    try {
      await saveSalonSettings(updatedSettings);
      showToast('تم حفظ مواعيد وبيانات الصالون بنجاح ✨', 'success');
      await loadSalonHeaderAndSettings();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}
