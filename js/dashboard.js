// =============================================================================
// Maqass (مِقَصْ) — The Barber's One-Screen Control Hub Logic (dashboard.js)
// Production Hardened Edition: Strict RLS Auth, Timezone Safe & Walk-in Buffer Check
// =============================================================================

import { CONFIG, supabase, ARABIC_DAYS } from './config.js';
import {
  getSalonSettings,
  getSalonForCurrentBarber,
  getBarbers,
  manageBarber,
  deleteBarber,
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
  signUpNewSalon,
  resetBarberPassword,
  updateUserPassword,
  signOutBarber,
  getBarberSession
} from './api.js?v=3.1.0';
import {
  formatTime12H,
  formatDateArabic,
  getEgyptLocalDate,
  generateWhatsAppLink,
  showToast,
  escapeHtml
} from './utils.js';

// Application State
const state = {
  currentTab: 'tab-queue',
  selectedDate: getEgyptLocalDate(),
  salonSettings: null,
  barbers: [],
  selectedBarberFilter: 'all',
  todayAppointments: [],
  allServices: [],
  blacklist: [],
  realtimeChannel: null
};

// DOM Elements Cache
const DOM = {
  // Auth
  loginGate: document.getElementById('login-gate'),
  tabAuthLogin: document.getElementById('tab-auth-login'),
  tabAuthRegister: document.getElementById('tab-auth-register'),
  loginForm: document.getElementById('login-form'),
  loginEmail: document.getElementById('login-email'),
  loginPassword: document.getElementById('login-password'),
  loginErrorAlert: document.getElementById('login-error-alert'),
  loginErrorText: document.getElementById('login-error-text'),
  btnForgotPassword: document.getElementById('btn-forgot-password'),

  // Register Form
  registerForm: document.getElementById('register-form'),
  regSalonName: document.getElementById('reg-salon-name'),
  regPhone: document.getElementById('reg-phone'),
  regEmail: document.getElementById('reg-email'),
  regPassword: document.getElementById('reg-password'),
  regBarberTypes: document.querySelectorAll('input[name="reg-barber-type"]'),
  regBarbersNamesContainer: document.getElementById('reg-barbers-names-container'),
  regBarberNames: document.getElementById('reg-barber-names'),
  btnRegisterSubmit: document.getElementById('btn-register-submit'),
  registerErrorAlert: document.getElementById('register-error-alert'),
  registerErrorText: document.getElementById('register-error-text'),

  dashboardWrapper: document.getElementById('dashboard-wrapper'),
  btnLogout: document.getElementById('btn-logout'),

  // Top Bar
  dashSalonName: document.getElementById('dash-salon-name'),
  dashViewsCount: document.getElementById('dash-views-count'),
  syncIndicator: document.getElementById('sync-indicator'),
  btnCopySalonLink: document.getElementById('btn-copy-salon-link'),
  btnViewClientPage: document.getElementById('btn-view-client-page'),

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
  queueBarberFilter: document.getElementById('queue-barber-filter'),
  queueCardsContainer: document.getElementById('queue-cards-container'),

  // Tab 2: Stats
  statCompleted: document.getElementById('stat-completed'),
  statPending: document.getElementById('stat-pending'),
  statNoshow: document.getElementById('stat-noshow'),
  statShowupRate: document.getElementById('stat-showup-rate'),
  servicesBreakdownList: document.getElementById('services-breakdown-list'),

  // Tab 3: Settings, Barbers & Blacklist
  barbersManageCard: document.getElementById('barbers-manage-card'),
  barbersManageList: document.getElementById('barbers-manage-list'),
  btnAddBarberModal: document.getElementById('btn-add-barber-modal'),
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
  walkinBarberGroup: document.getElementById('walkin-barber-group'),
  walkinBarberSelect: document.getElementById('walkin-barber-select'),
  walkinServicesGrid: document.getElementById('walkin-services-grid'),

  barberModal: document.getElementById('barber-modal'),
  barberModalTitle: document.getElementById('barber-modal-title'),
  btnCloseBarberModal: document.getElementById('btn-close-barber-modal'),
  barberForm: document.getElementById('barber-form'),
  barberIdInput: document.getElementById('barber-id-input'),
  barberNameInput: document.getElementById('barber-name-input'),

  serviceModal: document.getElementById('service-modal'),
  serviceModalTitle: document.getElementById('service-modal-title'),
  btnCloseServiceModal: document.getElementById('btn-close-service-modal'),
  serviceForm: document.getElementById('service-form'),
  serviceIdInput: document.getElementById('service-id-input'),
  serviceNameInput: document.getElementById('service-name-input'),
  serviceDurationInput: document.getElementById('service-duration-input'),
  servicePriceInput: document.getElementById('service-price-input'),

  // Password Recovery Modal Elements
  modalResetPassword: document.getElementById('modal-reset-password'),
  formResetPassword: document.getElementById('form-reset-password'),
  newRecoveryPassword: document.getElementById('new-recovery-password'),
  confirmRecoveryPassword: document.getElementById('confirm-recovery-password'),
  recoveryErrorAlert: document.getElementById('recovery-error-alert'),
  recoveryErrorText: document.getElementById('recovery-error-text'),
  btnSubmitResetPassword: document.getElementById('btn-submit-reset-password')
};

/**
 * Entry Point: Check Session & Boot Dashboard
 */
document.addEventListener('DOMContentLoaded', async () => {
  setupAuthEventListeners();

  // 1. Password Recovery listener via Supabase event or URL hash/query
  const isRecoveryFlow = window.location.hash.includes('type=recovery') || 
                         window.location.search.includes('type=recovery');

  let activeRecovery = isRecoveryFlow;

  supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      activeRecovery = true;
      openRecoveryModal();
    }
  });

  if (isRecoveryFlow) {
    openRecoveryModal();
    return;
  }

  const isAuthenticated = await getBarberSession();
  if (!isAuthenticated) {
    DOM.loginGate.style.display = 'grid';
    DOM.dashboardWrapper.style.display = 'none';
    return;
  }

  if (!activeRecovery) {
    await bootDashboard();
  }
});

/**
 * Opens Password Recovery Modal when user clicks reset password link
 */
function openRecoveryModal() {
  if (DOM.modalResetPassword) {
    DOM.modalResetPassword.style.display = 'flex';
    if (DOM.loginGate) DOM.loginGate.style.display = 'none';
    if (DOM.dashboardWrapper) DOM.dashboardWrapper.style.display = 'none';
    if (DOM.newRecoveryPassword) {
      setTimeout(() => DOM.newRecoveryPassword.focus(), 150);
    }
  }
}

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
    loadBarbersList(),
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
 * Authentication Form Listeners (Email & Password Login & New Salon Registration)
 */
function setupAuthEventListeners() {
  const modalContent = DOM.loginGate.querySelector('.modal-content');

  // Switch between Login and Register tabs
  if (DOM.tabAuthLogin && DOM.tabAuthRegister) {
    DOM.tabAuthLogin.addEventListener('click', () => {
      DOM.tabAuthLogin.classList.add('active');
      DOM.tabAuthRegister.classList.remove('active');
      DOM.loginForm.style.display = 'block';
      DOM.registerForm.style.display = 'none';
    });

    DOM.tabAuthRegister.addEventListener('click', () => {
      DOM.tabAuthRegister.classList.add('active');
      DOM.tabAuthLogin.classList.remove('active');
      DOM.loginForm.style.display = 'none';
      DOM.registerForm.style.display = 'block';
    });
  }

  // Toggle multi-barbers names input on radio change
  DOM.regBarberTypes.forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (DOM.regBarbersNamesContainer) {
        DOM.regBarbersNamesContainer.style.display = e.target.value === 'multi' ? 'block' : 'none';
      }
    });
  });

  // Clear errors when typing in login
  DOM.loginEmail.addEventListener('input', () => {
    DOM.loginEmail.classList.remove('input-error');
    if (DOM.loginErrorAlert) DOM.loginErrorAlert.style.display = 'none';
  });
  DOM.loginPassword.addEventListener('input', () => {
    DOM.loginPassword.classList.remove('input-error');
    if (DOM.loginErrorAlert) DOM.loginErrorAlert.style.display = 'none';
  });

  // Clear errors when typing in register
  if (DOM.registerForm) {
    DOM.registerForm.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', () => {
        input.classList.remove('input-error');
        if (DOM.registerErrorAlert) DOM.registerErrorAlert.style.display = 'none';
      });
    });
  }

  // 1. LOGIN SUBMISSION
  DOM.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = DOM.loginEmail.value.trim();
    const password = DOM.loginPassword ? DOM.loginPassword.value : '';

    if (DOM.loginErrorAlert) DOM.loginErrorAlert.style.display = 'none';
    DOM.loginEmail.classList.remove('input-error');
    DOM.loginPassword.classList.remove('input-error');

    if (!email || !password) {
      if (!email) DOM.loginEmail.classList.add('input-error');
      if (!password) DOM.loginPassword.classList.add('input-error');
      
      if (DOM.loginErrorAlert && DOM.loginErrorText) {
        DOM.loginErrorText.textContent = 'يرجى إدخال البريد الإلكتروني وكلمة المرور.';
        DOM.loginErrorAlert.style.display = 'flex';
      }
      showToast('يرجى إدخال البريد الإلكتروني وكلمة المرور.', 'error');
      triggerShake();
      return;
    }

    const submitBtn = document.getElementById('btn-login-submit');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'جاري التحقق... ⏳';

    try {
      await signInBarber(email, password);
      showToast('تم تسجيل الدخول بنجاح! أهلاً بك يا فنان ✂️', 'success');
      await bootDashboard();
    } catch (err) {
      showToast(err.message, 'error');
      if (DOM.loginErrorAlert && DOM.loginErrorText) {
        DOM.loginErrorText.textContent = err.message || 'بيانات الدخول غير صحيحة، يرجى المحاولة مرة أخرى.';
        DOM.loginErrorAlert.style.display = 'flex';
      }
      DOM.loginEmail.classList.add('input-error');
      DOM.loginPassword.classList.add('input-error');
      DOM.loginPassword.focus();
      triggerShake();
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    }
  });

  // 2. REGISTER NEW SALON SUBMISSION
  if (DOM.registerForm) {
    DOM.registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const salonName = DOM.regSalonName.value.trim();
      const phone = DOM.regPhone.value.trim();
      const email = DOM.regEmail.value.trim();
      const password = DOM.regPassword.value.trim();
      const selectedType = document.querySelector('input[name="reg-barber-type"]:checked')?.value || 'single';
      const barberNames = DOM.regBarberNames ? DOM.regBarberNames.value.trim() : '';

      if (DOM.registerErrorAlert) DOM.registerErrorAlert.style.display = 'none';

      if (!salonName || !phone || !email || !password) {
        if (DOM.registerErrorAlert && DOM.registerErrorText) {
          DOM.registerErrorText.textContent = 'يرجى ملء جميع الحقول الإلزامية.';
          DOM.registerErrorAlert.style.display = 'flex';
        }
        showToast('يرجى ملء جميع الحقول الإلزامية.', 'error');
        triggerShake();
        return;
      }

      if (password.length < 6) {
        if (DOM.registerErrorAlert && DOM.registerErrorText) {
          DOM.registerErrorText.textContent = 'يجب أن تكون كلمة المرور 6 أحرف أو أرقام على الأقل.';
          DOM.registerErrorAlert.style.display = 'flex';
        }
        showToast('يجب أن تكون كلمة المرور 6 أحرف أو أرقام على الأقل.', 'error');
        triggerShake();
        return;
      }

      const submitBtn = DOM.btnRegisterSubmit;
      const originalText = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.innerHTML = 'جاري إنشاء وتجهيز الصالون... ⏳';

      try {
        const res = await signUpNewSalon({
          email,
          password,
          salonName,
          phone,
          barberType: selectedType,
          barberNames
        });

        if (res.isExistingLogin) {
          showToast(`أهلاً بك مجدداً في ${res.salon?.salon_name || 'صالونك'}! تم تسجيل الدخول بنجاح 💈`, 'success');
        } else {
          showToast('تم إنشاء صالونك بنجاح! أهلاً بك في منصة مِقَصْ 💈✨', 'success');
        }
        await bootDashboard();
      } catch (err) {
        if (err.code === 'EMAIL_ALREADY_EXISTS') {
          // Seamless frictionless transition to Login tab
          if (DOM.tabAuthLogin) DOM.tabAuthLogin.click();
          if (DOM.loginEmail) DOM.loginEmail.value = email;
          if (DOM.loginPassword) {
            DOM.loginPassword.value = '';
            DOM.loginPassword.focus();
          }
          showToast('هذا البريد مسجل مسبقاً، تفضل بتسجيل الدخول 🔑', 'info');
          if (DOM.loginErrorAlert && DOM.loginErrorText) {
            DOM.loginErrorText.textContent = 'هذا الحساب موجود بالفعل، يرجى كتابة كلمة المرور الخاصة به للدخول.';
            DOM.loginErrorAlert.className = 'login-alert-info';
            DOM.loginErrorAlert.style.display = 'flex';
          }
        } else {
          showToast(err.message, 'error');
          if (DOM.registerErrorAlert && DOM.registerErrorText) {
            DOM.registerErrorText.textContent = err.message || 'تعذر إنشاء الحساب، يرجى المحاولة مجدداً.';
            DOM.registerErrorAlert.className = 'login-alert-error';
            DOM.registerErrorAlert.style.display = 'flex';
          }
          triggerShake();
        }
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
    });
  }

  // 3. FORGOT PASSWORD HANDLER
  if (DOM.btnForgotPassword) {
    DOM.btnForgotPassword.addEventListener('click', async () => {
      const email = DOM.loginEmail.value.trim();
      if (!email) {
        showToast('يرجى إدخال بريدك الإلكتروني أولاً في خانة البريد.', 'info');
        DOM.loginEmail.focus();
        DOM.loginEmail.classList.add('input-error');
        return;
      }

      if (!confirm(`هل تريد إرسال رابط استعادة كلمة المرور إلى البريد الإلكتروني التالي:\n${email}؟`)) {
        return;
      }

      const origText = DOM.btnForgotPassword.textContent;
      DOM.btnForgotPassword.disabled = true;
      DOM.btnForgotPassword.textContent = 'جاري الإرسال...';

      try {
        await resetBarberPassword(email);
        showToast('تم إرسال رابط استعادة كلمة المرور إلى بريدك الإلكتروني! 📧', 'success');
        if (DOM.loginErrorAlert && DOM.loginErrorText) {
          DOM.loginErrorText.textContent = 'تم إرسال رابط الاستعادة إلى بريدك، يرجى تفقد صندوق الوارد أو البريد المزعج.';
          DOM.loginErrorAlert.className = 'login-alert-info';
          DOM.loginErrorAlert.style.display = 'flex';
        }
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        DOM.btnForgotPassword.disabled = false;
        DOM.btnForgotPassword.textContent = origText;
      }
    });
  }

  // 4. RESET PASSWORD RECOVERY FORM SUBMISSION
  if (DOM.formResetPassword) {
    DOM.formResetPassword.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newPass = (DOM.newRecoveryPassword?.value || '').trim();
      const confirmPass = (DOM.confirmRecoveryPassword?.value || '').trim();

      if (DOM.recoveryErrorAlert) DOM.recoveryErrorAlert.style.display = 'none';

      if (!newPass || newPass.length < 6) {
        showRecoveryError('كلمة المرور يجب ألا تقل عن 6 أحرف أو أرقام.');
        return;
      }

      if (newPass !== confirmPass) {
        showRecoveryError('كلمتا المرور غير متطابقتين.');
        return;
      }

      DOM.btnSubmitResetPassword.disabled = true;
      const origBtnText = DOM.btnSubmitResetPassword.innerHTML;
      DOM.btnSubmitResetPassword.innerHTML = 'جاري حفظ كلمة المرور... ⏳';

      try {
        await updateUserPassword(newPass);
        if (DOM.modalResetPassword) DOM.modalResetPassword.style.display = 'none';
        history.replaceState(null, '', window.location.pathname);
        showToast('تم تعيين كلمة المرور بنجاح! مرحباً بك في صالونك 🎉', 'success');
        await bootDashboard();
      } catch (err) {
        showRecoveryError(err.message || 'تعذر تحديث كلمة المرور.');
      } finally {
        DOM.btnSubmitResetPassword.disabled = false;
        DOM.btnSubmitResetPassword.innerHTML = origBtnText;
      }
    });
  }

  function showRecoveryError(msg) {
    if (DOM.recoveryErrorAlert && DOM.recoveryErrorText) {
      DOM.recoveryErrorText.textContent = msg;
      DOM.recoveryErrorAlert.style.display = 'flex';
    }
    showToast(msg, 'error');
  }

  function triggerShake() {
    if (modalContent) {
      modalContent.classList.remove('shake-error');
      void modalContent.offsetWidth;
      modalContent.classList.add('shake-error');
    }
  }

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
    const settings = await getSalonForCurrentBarber();
    state.salonSettings = settings;

    // Header info
    if (settings.salon_name) DOM.dashSalonName.textContent = settings.salon_name;
    if (settings.total_views) DOM.dashViewsCount.textContent = Number(settings.total_views).toLocaleString('ar-EG');

    // Update Public Client Link and Sharing
    if (settings.slug) {
      const origin = window.location.origin;
      const basePath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);
      const fullClientUrl = `${origin}${basePath}index.html?s=${settings.slug}`;

      if (DOM.btnViewClientPage) {
        DOM.btnViewClientPage.href = fullClientUrl;
      }

      const btnShareWa = document.getElementById('btn-share-whatsapp');
      if (btnShareWa) {
        const waText = encodeURIComponent(`احجز دورك الآن في ${settings.salon_name || 'صالون الحلاقة'} أونلاين بدون انتظار في الطابور عبر الرابط:\n${fullClientUrl} ✂️💈`);
        btnShareWa.href = `https://wa.me/?text=${waText}`;
      }
    }

    // Apply Lock / Unlock UI state
    applySuspensionState(settings);

    // Subscribe to realtime status updates on this salon
    if (settings.id) {
      setupSalonStatusSubscription(settings.id);
    }

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
 * Applies lockdown or unlock UI state across the dashboard
 */
function applySuspensionState(settings) {
  const suspAlert = document.getElementById('salon-suspended-alert');
  const suspReason = document.getElementById('salon-suspended-reason');
  const isSuspended = !!settings.is_suspended;

  // Header lock badge
  let lockBadge = document.getElementById('dash-lock-badge');
  if (isSuspended) {
    if (!lockBadge && DOM.salonName) {
      lockBadge = document.createElement('span');
      lockBadge.id = 'dash-lock-badge';
      lockBadge.className = 'badge';
      lockBadge.style.cssText = 'background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid #ef4444; margin-right: 8px; font-size: 0.8rem;';
      lockBadge.textContent = 'حساب مقفل بقرار الإدارة 🔒';
      DOM.salonName.parentNode.appendChild(lockBadge);
    }
    if (suspAlert) {
      suspAlert.style.display = 'flex';
      if (suspReason && settings.suspended_reason) {
        suspReason.textContent = `السبب: ${settings.suspended_reason} — يرجى التواصل مع إدارة منصة مِقَصْ لتسوية وتفعيل الحساب.`;
      }
    }
    // Hard Lock Controls
    if (DOM.btnTogglePause) DOM.btnTogglePause.disabled = true;
    if (DOM.btnOpenWalkinModal) DOM.btnOpenWalkinModal.disabled = true;
    if (DOM.btnSaveSalonSettings) DOM.btnSaveSalonSettings.disabled = true;
    if (DOM.settingSalonName) DOM.settingSalonName.disabled = true;
    if (DOM.settingSalonPhone) DOM.settingSalonPhone.disabled = true;
    if (DOM.btnOpenAddServiceModal) DOM.btnOpenAddServiceModal.disabled = true;
  } else {
    // Restore all controls
    if (lockBadge) lockBadge.remove();
    if (suspAlert) suspAlert.style.display = 'none';
    if (DOM.btnTogglePause) DOM.btnTogglePause.disabled = false;
    if (DOM.btnOpenWalkinModal) DOM.btnOpenWalkinModal.disabled = false;
    if (DOM.btnSaveSalonSettings) DOM.btnSaveSalonSettings.disabled = false;
    if (DOM.settingSalonName) DOM.settingSalonName.disabled = false;
    if (DOM.settingSalonPhone) DOM.settingSalonPhone.disabled = false;
    if (DOM.btnOpenAddServiceModal) DOM.btnOpenAddServiceModal.disabled = false;
  }
}

/**
 * Listens to Realtime changes on salon status for immediate lock/unlock response
 */
let salonRealtimeSub = null;
function setupSalonStatusSubscription(salonId) {
  if (!salonId || isDemoMode() || typeof supabase === 'undefined' || !supabase.channel) return;
  if (salonRealtimeSub) {
    supabase.removeChannel(salonRealtimeSub);
    salonRealtimeSub = null;
  }
  try {
    salonRealtimeSub = supabase
      .channel(`salon-status-sub-${salonId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'salons',
          filter: `id=eq.${salonId}`
        },
        (payload) => {
          if (payload.new) {
            state.salonSettings = { ...state.salonSettings, ...payload.new };
            applySuspensionState(payload.new);
            updatePauseButtonUI(payload.new.is_paused);
            if (payload.new.is_suspended) {
              showToast('تنبيه هام: تم تجميد وقفل حساب الصالون بقرار إدارة المنصة 🔒', 'error', 8000);
            } else {
              showToast('تم فك القفل وإعادة تنشيط حساب الصالون بنجاح، عادت كافة الخدمات للعمل 🟢', 'success', 6000);
            }
          }
        }
      )
      .subscribe();
  } catch (err) {
    console.warn('Salon status subscription warning:', err);
  }
}

/**
 * Loads and renders Barbers / Staff List
 */
async function loadBarbersList() {
  if (!state.salonSettings?.id) return;

  try {
    const barbers = await getBarbers(state.salonSettings.id);
    state.barbers = barbers;

    // Render in Tab 3 Barbers Management
    if (DOM.barbersManageList) {
      DOM.barbersManageList.innerHTML = '';

      if (barbers.length === 0) {
        DOM.barbersManageList.innerHTML = `
          <div style="font-size: 0.85rem; color: var(--text-muted); text-align: center; padding: 12px;">
            لا يوجد حلاقين مسجلين حالياً. اضغط على "+ إضافة حلاق" لإضافة كراسي العمل.
          </div>
        `;
      } else {
        barbers.forEach(barber => {
          const item = document.createElement('div');
          item.style.display = 'flex';
          item.style.alignItems = 'center';
          item.style.justifyContent = 'space-between';
          item.style.padding = '10px 14px';
          item.style.background = 'rgba(255,255,255,0.03)';
          item.style.borderRadius = 'var(--radius-sm)';
          item.style.border = '1px solid var(--border-color)';

          item.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 1.2rem;">💈</span>
              <div>
                <div style="font-weight: 700; font-size: 0.95rem;">${escapeHtml(barber.name)}</div>
                <div style="font-size: 0.78rem; color: ${barber.is_active ? 'var(--status-completed)' : 'var(--status-cancelled)'};">
                  ${barber.is_active ? '● متاح للحجز' : '● متوقف مؤقتاً'}
                </div>
              </div>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary btn-toggle-barber" style="width: auto; padding: 4px 10px; font-size: 0.78rem;">
                ${barber.is_active ? 'تعطيل ⏸️' : 'تفعيل ▶️'}
              </button>
              ${barbers.length > 1 ? `
                <button class="btn btn-secondary btn-del-barber" style="width: auto; padding: 4px 10px; font-size: 0.78rem; color: #ef4444;">
                  حذف 🗑️
                </button>
              ` : ''}
            </div>
          `;

          // Toggle Active/Inactive
          item.querySelector('.btn-toggle-barber').addEventListener('click', async () => {
            try {
              await manageBarber({
                id: barber.id,
                salonId: state.salonSettings.id,
                name: barber.name,
                isActive: !barber.is_active
              });
              showToast(`تم تحديث حالة الحلاق (${barber.name})`, 'success');
              await loadBarbersList();
              await loadQueueData(false);
            } catch (err) {
              showToast(err.message, 'error');
            }
          });

          // Delete Barber (if > 1)
          const delBtn = item.querySelector('.btn-del-barber');
          if (delBtn) {
            delBtn.addEventListener('click', async () => {
              if (confirm(`هل أنت متأكد من حذف الحلاق (${barber.name})؟`)) {
                try {
                  await deleteBarber(barber.id);
                  showToast('تم حذف الحلاق بنجاح', 'success');
                  await loadBarbersList();
                  await loadQueueData(false);
                } catch (err) {
                  showToast(err.message, 'error');
                }
              }
            });
          }

          DOM.barbersManageList.appendChild(item);
        });
      }
    }

    // Render Barber Filter in Queue Tab if > 1 barber
    if (DOM.queueBarberFilter) {
      if (barbers.length > 1) {
        DOM.queueBarberFilter.style.display = 'flex';
        DOM.queueBarberFilter.innerHTML = '';

        const allPill = document.createElement('button');
        allPill.className = `btn btn-secondary ${state.selectedBarberFilter === 'all' ? 'active-filter' : ''}`;
        allPill.style.cssText = 'width: auto; padding: 5px 12px; font-size: 0.8rem; border-radius: 20px;';
        allPill.textContent = '✨ جميع الكراسي';
        allPill.addEventListener('click', () => {
          state.selectedBarberFilter = 'all';
          updateQueueFilterPills();
          loadQueueData(false);
        });
        DOM.queueBarberFilter.appendChild(allPill);

        barbers.forEach(b => {
          const pill = document.createElement('button');
          pill.className = `btn btn-secondary ${state.selectedBarberFilter === b.id ? 'active-filter' : ''}`;
          pill.style.cssText = 'width: auto; padding: 5px 12px; font-size: 0.8rem; border-radius: 20px;';
          pill.textContent = `💈 ${b.name}`;
          pill.addEventListener('click', () => {
            state.selectedBarberFilter = b.id;
            updateQueueFilterPills();
            loadQueueData(false);
          });
          DOM.queueBarberFilter.appendChild(pill);
        });
      } else {
        DOM.queueBarberFilter.style.display = 'none';
        state.selectedBarberFilter = 'all';
      }
    }

    // Update Walk-in Barber Selector
    if (DOM.walkinBarberGroup && DOM.walkinBarberSelect) {
      if (barbers.length > 1) {
        DOM.walkinBarberGroup.style.display = 'block';
        DOM.walkinBarberSelect.innerHTML = barbers
          .filter(b => b.is_active)
          .map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`)
          .join('');
      } else {
        DOM.walkinBarberGroup.style.display = 'none';
      }
    }

  } catch (err) {
    console.warn('Error loading barbers:', err);
  }
}

function updateQueueFilterPills() {
  if (!DOM.queueBarberFilter) return;
  const buttons = DOM.queueBarberFilter.querySelectorAll('button');
  buttons.forEach(btn => {
    btn.style.borderColor = 'var(--border-color)';
    btn.style.background = 'rgba(255,255,255,0.03)';
  });
  // Highlight active
  buttons.forEach(btn => {
    if (
      (state.selectedBarberFilter === 'all' && btn.textContent.includes('جميع')) ||
      state.barbers.some(b => b.id === state.selectedBarberFilter && btn.textContent.includes(b.name))
    ) {
      btn.style.borderColor = 'var(--gold-primary)';
      btn.style.background = 'rgba(212, 175, 55, 0.15)';
    }
  });
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
    const appointments = await getTodayAppointments(
      state.selectedDate,
      state.salonSettings?.id,
      state.selectedBarberFilter
    );
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
          <span>${escapeHtml(app.client_name)}</span>
          ${isWalkIn ? '<span class="badge" style="background: rgba(16,185,129,0.15); color: #34d399;">مباشر ⚡</span>' : '<span class="badge" style="background: rgba(59,130,246,0.15); color: #60a5fa;">أونلاين 🌐</span>'}
        </div>
        <div class="queue-time">${timeFormatted}</div>
      </div>

      <div class="queue-meta">
        <span>💈 ${escapeHtml(serviceName)} (${duration} دقيقة)</span>
        <span>💵 ${Number(price).toFixed(0)} ج.م (للعرض)</span>
        ${!isWalkIn ? `<a href="${whatsappUrl}" target="_blank" rel="noopener" class="badge" style="background: #25d366; color: #fff; text-decoration: none; padding: 3px 8px;" title="إرسال تذكير واتساب">💬 واتساب</a>` : ''}
        ${statusBadge}
      </div>

      <!-- Giant 1-Tap Status Actions -->
      <div class="queue-actions">
        <button class="btn-action btn-action-start" data-id="${app.id}" data-phone="${escapeHtml(app.client_phone)}" ${app.status === 'in_progress' ? 'disabled style="opacity: 0.4;"' : ''}>
          <span>✂️</span>
          <span>بدأ الحلاقة</span>
        </button>

        <button class="btn-action btn-action-done" data-id="${app.id}" data-phone="${escapeHtml(app.client_phone)}" ${app.status === 'completed' ? 'disabled style="opacity: 0.4;"' : ''}>
          <span>✓</span>
          <span>تم الانتهاء</span>
        </button>

        <button class="btn-action btn-action-noshow" data-id="${app.id}" data-phone="${escapeHtml(app.client_phone)}" ${app.status === 'no_show' ? 'disabled style="opacity: 0.4;"' : ''}>
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
    await updateAppointmentStatus(appointmentId, newStatus, clientPhone, state.salonSettings?.id);
    
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
      <span style="font-weight: 600; font-size: 0.9rem;">${escapeHtml(name)}</span>
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
          <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-primary);">${escapeHtml(s.name)}</div>
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
      <div class="service-name">${escapeHtml(s.name)}</div>
      <div class="service-meta">
        <span>⏱️ ${s.duration_minutes} دقيقة</span>
        <span class="service-price">${Number(s.price).toFixed(0)} ج.م</span>
      </div>
    `;

    btn.addEventListener('click', async () => {
      try {
        const selectedBarberId = DOM.walkinBarberSelect?.value || null;
        const result = await addWalkInAppointment(s.id, false, state.salonSettings?.id, selectedBarberId);

        // Check if Buffer Warning is returned
        if (result && result.warning) {
          const confirmForce = confirm(
            `${result.message}\n\nهل تريد قفل الكرسي لزبون مباشر وبدء الحلاقة على أي حال؟`
          );

          if (!confirmForce) {
            return;
          }

          // Force lock chair
          await addWalkInAppointment(s.id, true, state.salonSettings?.id, selectedBarberId);
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
  if (!DOM.blacklistTableBody) return;
  try {
    const blacklist = await getBlacklist(state.salonSettings?.id);
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
        <td style="font-family: monospace; font-weight: 700;">${escapeHtml(b.client_phone)}</td>
        <td><span class="badge badge-no-show">${b.no_show_count} مرات غياب</span></td>
        <td>
          ${isBlocked 
            ? '<span class="badge badge-cancelled">محظور تماماً 🛑</span>' 
            : '<span class="badge badge-pending">تحذير (متبقي فرصة) ⚠️</span>'}
        </td>
        <td>
          <button class="btn btn-secondary btn-unblock" data-phone="${escapeHtml(b.client_phone)}" style="width: auto; padding: 4px 10px; font-size: 0.78rem;">
            فك الحظر ✓
          </button>
        </td>
      `;

      tr.querySelector('.btn-unblock').addEventListener('click', async () => {
        if (confirm(`فك حظر الرقم (${b.client_phone}) وإعادته للقائمة البيضاء؟`)) {
          try {
            await unblockClient(b.client_phone, state.salonSettings?.id);
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
      await saveSalonSettings(updatedSettings, state.salonSettings?.id);
      showToast('تم حفظ مواعيد وبيانات الصالون بنجاح ✨', 'success');
      await loadSalonHeaderAndSettings();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Copy Salon Public Link (Single debounced handler)
  if (DOM.btnCopySalonLink) {
    let copyDebounce = false;
    DOM.btnCopySalonLink.addEventListener('click', () => {
      if (copyDebounce) return;
      copyDebounce = true;
      setTimeout(() => { copyDebounce = false; }, 800);

      if (!state.salonSettings?.slug) {
        showToast('جاري تجهيز رابط الصالون...', 'error');
        return;
      }
      const fullUrl = window.location.origin + window.location.pathname.replace(/dashboard\.html$/i, '') + 'index.html?s=' + state.salonSettings.slug;
      navigator.clipboard.writeText(fullUrl).then(() => {
        showToast('تم نسخ رابط صالونك بنجاح! شاركه مع زبائنك ✂️', 'success');
      }).catch(() => {
        prompt('انسخ رابط حجز صالونك:', fullUrl);
      });
    });
  }

  // Barber Modal Listeners
  if (DOM.btnAddBarberModal) {
    DOM.btnAddBarberModal.addEventListener('click', () => {
      DOM.barberModalTitle.textContent = 'إضافة حلاق / كرسي جديد';
      DOM.barberIdInput.value = '';
      DOM.barberNameInput.value = '';
      DOM.barberModal.style.display = 'grid';
    });
  }

  if (DOM.btnCloseBarberModal) {
    DOM.btnCloseBarberModal.addEventListener('click', () => {
      DOM.barberModal.style.display = 'none';
    });
  }

  if (DOM.barberForm) {
    DOM.barberForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = DOM.barberNameInput.value.trim();
      const barberId = DOM.barberIdInput.value || null;

      if (!name) return;

      try {
        await manageBarber({
          id: barberId,
          salonId: state.salonSettings?.id,
          name: name,
          isActive: true
        });

        showToast('تم حفظ بيانات الحلاق بنجاح ✨', 'success');
        DOM.barberModal.style.display = 'none';
        await loadBarbersList();
        await loadQueueData(false);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }
}
