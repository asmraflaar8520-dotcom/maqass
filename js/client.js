// =============================================================================
// Maqass (مِقَصْ) — Client Booking Portal Logic (client.js)
// Pure ES6 Browser Module, 100% Free-Tier & GitHub Pages Ready
// Timezone-Safe (Africa/Cairo) & Double-Booking Auto-Recovery
// =============================================================================

import { CONFIG, ARABIC_DAYS } from './config.js';
import { 
  getSalonSettings, 
  getBarbers,
  getActiveServices, 
  getBookedSlots, 
  checkBlacklist, 
  createAppointment 
} from './api.js';
import { 
  calculateAvailableSlots, 
  generateWhatsAppLink, 
  triggerVisitorCounter, 
  formatDateArabic, 
  formatTime12H,
  getEgyptLocalDate,
  isValidEgyptianPhone, 
  showToast,
  escapeHtml 
} from './utils.js';

// Read URL parameter for salon slug (?s=SLUG or ?salon=SLUG)
const urlParams = new URLSearchParams(window.location.search);
const currentSalonSlug = urlParams.get('s') || urlParams.get('salon') || '';

// Application State
const state = {
  currentStep: 1,
  salonSlug: currentSalonSlug,
  salonSettings: null,
  barbers: [],
  selectedBarberId: 'any',
  services: [],
  selectedService: null,
  selectedDate: '',
  selectedSlot: null,
  clientName: '',
  clientPhone: '',
  createdAppointment: null
};

// DOM Elements Cache
const DOM = {
  salonName: document.getElementById('salon-name-display'),
  salonStatus: document.getElementById('salon-status-indicator'),
  viewsCount: document.getElementById('views-count'),
  pauseBanner: document.getElementById('pause-banner'),
  suspendedBanner: document.getElementById('suspended-banner'),
  suspendedDesc: document.getElementById('suspended-desc'),
  platformGateway: document.getElementById('platform-gateway-screen'),
  salonNotFound: document.getElementById('salon-not-found-screen'),
  inputGatewaySlug: document.getElementById('input-gateway-slug'),
  btnGatewayGo: document.getElementById('btn-gateway-go'),
  bookingContainer: document.getElementById('booking-container'),
  setupModal: document.getElementById('setup-modal'),
  btnSaveSetup: document.getElementById('btn-save-setup'),
  setupUrl: document.getElementById('setup-url'),
  setupKey: document.getElementById('setup-key'),

  // Step Containers
  step1: document.getElementById('step-1'),
  step2: document.getElementById('step-2'),
  step3: document.getElementById('step-3'),
  successScreen: document.getElementById('success-screen'),

  // Step Nodes
  stepNode1: document.getElementById('step-node-1'),
  stepNode2: document.getElementById('step-node-2'),
  stepNode3: document.getElementById('step-node-3'),

  // Step 1
  servicesLoading: document.getElementById('services-loading'),
  servicesContainer: document.getElementById('services-container'),
  btnStep1Next: document.getElementById('btn-step-1-next'),

  // Step 2
  step2ServiceBadge: document.getElementById('step-2-service-badge'),
  clientBarberSelection: document.getElementById('client-barber-selection'),
  clientBarbersContainer: document.getElementById('client-barbers-container'),
  bookingDate: document.getElementById('booking-date'),
  dateLocalizedLabel: document.getElementById('date-localized-label'),
  slotsLoading: document.getElementById('slots-loading'),
  slotsContainer: document.getElementById('slots-container'),
  slotsEmpty: document.getElementById('slots-empty'),
  btnStep2Back: document.getElementById('btn-step-2-back'),
  btnStep2Next: document.getElementById('btn-step-2-next'),

  // Step 3
  summaryServiceName: document.getElementById('summary-service-name'),
  summaryDuration: document.getElementById('summary-duration'),
  summaryDate: document.getElementById('summary-date'),
  summaryBarberItem: document.getElementById('summary-barber-item'),
  summaryBarberName: document.getElementById('summary-barber-name'),
  summaryTime: document.getElementById('summary-time'),
  bookingForm: document.getElementById('booking-form'),
  clientNameInput: document.getElementById('client-name'),
  clientPhoneInput: document.getElementById('client-phone'),
  blacklistAlert: document.getElementById('blacklist-alert'),
  btnStep3Back: document.getElementById('btn-step-3-back'),
  btnSubmitBooking: document.getElementById('btn-submit-booking'),

  // Ticket & Success
  ticketTime: document.getElementById('ticket-time'),
  ticketClient: document.getElementById('ticket-client'),
  ticketService: document.getElementById('ticket-service'),
  ticketBarber: document.getElementById('ticket-barber'),
  ticketDate: document.getElementById('ticket-date'),
  btnWhatsAppConfirm: document.getElementById('btn-whatsapp-confirm'),
  btnNewBooking: document.getElementById('btn-new-booking')
};

/**
 * Entry Point: Initializes Portal on DOM Ready
 */
document.addEventListener('DOMContentLoaded', () => {
  initCredentialsModal();
  initStoredClientInfo();
  initDateConstraints();
  setupEventListeners();

  // Instant parallel data fetching & background non-blocking counter
  initVisitorCounter(); // Non-blocking
  loadSalonProfile();   // Instant cache render + background network refresh
  loadServices();       // Instant cache render + background network refresh
});

/**
 * Shows credential setup modal if running for the first time with unconfigured keys
 */
function initCredentialsModal() {
  const isDefaultUrl = !CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.includes('YOUR_PROJECT_ID');
  const isDefaultKey = !CONFIG.SUPABASE_ANON_KEY || CONFIG.SUPABASE_ANON_KEY.includes('YOUR_SUPABASE_ANON_KEY');

  if ((isDefaultUrl || isDefaultKey) && localStorage.getItem('MAQASS_DEMO_MODE') !== 'true') {
    DOM.setupModal.style.display = 'grid';

    DOM.btnSaveSetup.addEventListener('click', () => {
      const url = DOM.setupUrl.value.trim();
      const key = DOM.setupKey.value.trim();

      if (!url || !key) {
        showToast('يرجى ملء رابط المشروع والمفتاح العام معاً.', 'error');
        return;
      }

      localStorage.removeItem('MAQASS_DEMO_MODE');
      localStorage.setItem('MAQASS_SUPABASE_URL', url);
      localStorage.setItem('MAQASS_SUPABASE_ANON_KEY', key);
      DOM.setupModal.style.display = 'none';
      showToast('تم حفظ الإعدادات بنجاح، جاري التحميل...', 'success');
      setTimeout(() => window.location.reload(), 600);
    });

    const btnDemoMode = document.getElementById('btn-demo-mode');
    if (btnDemoMode) {
      btnDemoMode.addEventListener('click', () => {
        localStorage.setItem('MAQASS_DEMO_MODE', 'true');
        DOM.setupModal.style.display = 'none';
        showToast('تم تفعيل وضع المعاينة السريعة بنجاح! 💈', 'success');
        setTimeout(() => window.location.reload(), 400);
      });
    }
  }
}

/**
 * Loads cached client phone and name from localStorage for instant re-booking
 */
function initStoredClientInfo() {
  const savedName = localStorage.getItem(CONFIG.STORAGE_KEYS.USER_NAME);
  const savedPhone = localStorage.getItem(CONFIG.STORAGE_KEYS.USER_PHONE);

  if (savedName) DOM.clientNameInput.value = savedName;
  if (savedPhone) DOM.clientPhoneInput.value = savedPhone;
}

/**
 * Triggers session-guarded atomic visitor count in background
 */
async function initVisitorCounter() {
  try {
    const updatedCount = await triggerVisitorCounter();
    if (updatedCount !== null && DOM.viewsCount) {
      DOM.viewsCount.textContent = Number(updatedCount).toLocaleString('ar-EG');
    }
  } catch (err) {
    console.warn('Visitor counter background check:', err);
  }
}

/**
 * Renders salon profile in DOM
 */
function renderSalonProfileDOM(settings) {
  if (!settings) return;
  state.salonSettings = settings;

  // Render salon name
  if (settings.salon_name && DOM.salonName) {
    DOM.salonName.textContent = settings.salon_name;
    document.title = `${settings.salon_name} | حجز موعد`;
  }

  // Render total views
  if (settings.total_views && DOM.viewsCount) {
    DOM.viewsCount.textContent = Number(settings.total_views).toLocaleString('ar-EG');
  }

  // Check operational & suspension status
  if (settings.is_suspended) {
    if (DOM.suspendedBanner) {
      DOM.suspendedBanner.style.display = 'flex';
      if (DOM.suspendedDesc) {
        DOM.suspendedDesc.textContent = settings.suspended_reason 
          ? `السبب: ${settings.suspended_reason} — يرجى التواصل مع إدارة الصالون أو المنصة.` 
          : 'نعتذر منك، تم إيقاف وتجميد خدمات هذا الصالون حالياً بقرار من إدارة المنصة.';
      }
    }
    if (DOM.pauseBanner) DOM.pauseBanner.style.display = 'none';
    DOM.bookingContainer.style.display = 'none';
    DOM.salonStatus.textContent = 'الصالون متوقف ومغلق حالياً 🔒';
    DOM.salonStatus.style.color = 'var(--status-cancelled)';
    return;
  } else if (DOM.suspendedBanner) {
    DOM.suspendedBanner.style.display = 'none';
  }

  if (settings.is_paused) {
    DOM.pauseBanner.style.display = 'flex';
    DOM.bookingContainer.style.display = 'none';
    DOM.salonStatus.textContent = 'الصالون في استراحة مؤقتة 🛑';
    DOM.salonStatus.style.color = 'var(--status-cancelled)';
  } else {
    DOM.pauseBanner.style.display = 'none';
    DOM.bookingContainer.style.display = 'block';
    DOM.salonStatus.textContent = 'مفتوح ويستقبل الحجوزات 🟢';
    DOM.salonStatus.style.color = 'var(--status-completed)';
  }
}

/**
 * Loads and renders salon settings & status (SWR: Instant Cache + Fresh Network)
 * Enforces strict multi-tenancy: clients only see the specific salon they visited
 */
async function loadSalonProfile() {
  // 1. If NO salon slug was specified in URL: show Platform Gateway
  if (!state.salonSlug) {
    if (DOM.platformGateway) DOM.platformGateway.style.display = 'block';
    if (DOM.bookingContainer) DOM.bookingContainer.style.display = 'none';
    if (DOM.salonNotFound) DOM.salonNotFound.style.display = 'none';
    if (DOM.pauseBanner) DOM.pauseBanner.style.display = 'none';
    if (DOM.suspendedBanner) DOM.suspendedBanner.style.display = 'none';
    if (DOM.salonName) DOM.salonName.textContent = 'منصة مِقَصْ';
    if (DOM.salonStatus) DOM.salonStatus.textContent = 'منظومة حجز صالونات الحلاقة 💈';
    initGatewayLookup();
    return;
  }

  // 2. Slug was provided: strictly fetch that salon
  const cacheKey = `maqass_cached_salon_${state.salonSlug}`;

  // Instant cache render
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) renderSalonProfileDOM(JSON.parse(cached));
  } catch {}

  // Fresh fetch from network
  try {
    const settings = await getSalonSettings(state.salonSlug);

    if (!settings) {
      // Salon not found by that slug!
      if (DOM.salonNotFound) DOM.salonNotFound.style.display = 'block';
      if (DOM.bookingContainer) DOM.bookingContainer.style.display = 'none';
      if (DOM.platformGateway) DOM.platformGateway.style.display = 'none';
      if (DOM.pauseBanner) DOM.pauseBanner.style.display = 'none';
      if (DOM.suspendedBanner) DOM.suspendedBanner.style.display = 'none';
      if (DOM.salonName) DOM.salonName.textContent = 'صالون غير مسجل';
      if (DOM.salonStatus) DOM.salonStatus.textContent = 'الرابط غير صحيح أو منتهي ⚠️';
      return;
    }

    if (DOM.salonNotFound) DOM.salonNotFound.style.display = 'none';
    if (DOM.platformGateway) DOM.platformGateway.style.display = 'none';

    localStorage.setItem(cacheKey, JSON.stringify(settings));
    renderSalonProfileDOM(settings);

    // Fetch active barbers and active services for this specific salon
    if (settings && settings.id && !settings.is_suspended) {
      const barbers = await getBarbers(settings.id);
      state.barbers = barbers;
      renderBarberPillsDOM(barbers);

      const services = await getActiveServices(settings.id);
      renderServicesDOM(services);
    }

    // Subscribe to live realtime status updates for this salon
    if (settings && settings.id) {
      subscribeToSalonRealtime(settings.id);
    }
  } catch (err) {
    console.warn('Could not load salon settings:', err);
  }
}

/**
 * Listens to Realtime changes on the salon record (lock / unlock / pause)
 */
let salonRealtimeChannel = null;
function subscribeToSalonRealtime(salonId) {
  if (!salonId || typeof supabase === 'undefined' || !supabase.channel) return;
  try {
    if (salonRealtimeChannel) {
      supabase.removeChannel(salonRealtimeChannel);
      salonRealtimeChannel = null;
    }
    salonRealtimeChannel = supabase
      .channel(`salon-client-realtime-${salonId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'salons',
          filter: `id=eq.${salonId}`
        },
        async (payload) => {
          if (payload.new) {
            state.salonSettings = { ...state.salonSettings, ...payload.new };
            renderSalonProfileDOM(payload.new);
            if (!payload.new.is_suspended) {
              const services = await getActiveServices(salonId);
              renderServicesDOM(services);
            }
          }
        }
      )
      .subscribe();
  } catch (err) {
    console.warn('Realtime subscription warning:', err);
  }
}

/**
 * Handles salon lookup from the platform gateway
 */
function initGatewayLookup() {
  if (!DOM.btnGatewayGo || !DOM.inputGatewaySlug) return;
  const navigate = () => {
    const raw = DOM.inputGatewaySlug.value.trim();
    if (!raw) return;
    const slug = raw.replace(/^.*[?&]s=/, '').replace(/^\//, '');
    if (slug) {
      window.location.search = `?s=${encodeURIComponent(slug)}`;
    }
  };
  DOM.btnGatewayGo.addEventListener('click', navigate);
  DOM.inputGatewaySlug.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') navigate();
  });
}

/**
 * Renders Barber Selection Pills in Step 2 if salon has multiple barbers
 */
function renderBarberPillsDOM(barbers) {
  if (!DOM.clientBarberSelection || !DOM.clientBarbersContainer) return;

  if (!Array.isArray(barbers) || barbers.length <= 1) {
    DOM.clientBarberSelection.style.display = 'none';
    state.selectedBarberId = barbers?.[0]?.id || 'any';
    return;
  }

  DOM.clientBarberSelection.style.display = 'block';
  DOM.clientBarbersContainer.innerHTML = '';

  // 1. Any Barber Pill (Default)
  const anyBtn = document.createElement('button');
  anyBtn.type = 'button';
  anyBtn.className = `btn btn-secondary ${state.selectedBarberId === 'any' ? 'active-filter' : ''}`;
  anyBtn.style.cssText = 'width: auto; padding: 6px 14px; font-size: 0.85rem; border-radius: 20px;';
  anyBtn.textContent = '✨ أي حلاق متاح (الأسرع)';
  anyBtn.addEventListener('click', () => {
    state.selectedBarberId = 'any';
    updateBarberPillsSelection();
    loadAvailableTimeSlots();
  });
  DOM.clientBarbersContainer.appendChild(anyBtn);

  // 2. Individual Barbers
  barbers.forEach(barber => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn btn-secondary ${state.selectedBarberId === barber.id ? 'active-filter' : ''}`;
    btn.style.cssText = 'width: auto; padding: 6px 14px; font-size: 0.85rem; border-radius: 20px;';
    btn.textContent = `💈 ${barber.name}`;
    btn.addEventListener('click', () => {
      state.selectedBarberId = barber.id;
      updateBarberPillsSelection();
      loadAvailableTimeSlots();
    });
    DOM.clientBarbersContainer.appendChild(btn);
  });
}

function updateBarberPillsSelection() {
  if (!DOM.clientBarbersContainer) return;
  const buttons = DOM.clientBarbersContainer.querySelectorAll('button');
  buttons.forEach(btn => {
    btn.style.borderColor = 'var(--border-color)';
    btn.style.background = 'rgba(255,255,255,0.03)';
  });
  buttons.forEach(btn => {
    if (
      (state.selectedBarberId === 'any' && btn.textContent.includes('أي حلاق')) ||
      state.barbers.some(b => b.id === state.selectedBarberId && btn.textContent.includes(b.name))
    ) {
      btn.style.borderColor = 'var(--gold-primary)';
      btn.style.background = 'rgba(212, 175, 55, 0.15)';
    }
  });
}

/**
 * Renders services catalog in DOM
 */
function renderServicesDOM(services) {
  if (!Array.isArray(services) || services.length === 0) return;
  state.services = services;

  DOM.servicesLoading.style.display = 'none';
  DOM.servicesContainer.style.display = 'grid';
  DOM.servicesContainer.innerHTML = '';

  services.forEach(service => {
    const card = document.createElement('div');
    card.className = 'service-card';
    card.dataset.id = service.id;
    if (state.selectedService && state.selectedService.id === service.id) {
      card.classList.add('selected');
    }

    card.innerHTML = `
      <div class="service-name">${escapeHtml(service.name)}</div>
      <div class="service-meta">
        <span>⏱️ ${service.duration_minutes} دقيقة</span>
        <span class="service-price">${Number(service.price).toFixed(0)} ج.م</span>
      </div>
    `;

    card.addEventListener('click', () => selectService(service, card));
    DOM.servicesContainer.appendChild(card);
  });
}

/**
 * Loads and renders active services catalog (SWR: Instant Cache + Fresh Network)
 */
async function loadServices() {
  // 1. Instant cache render (0ms delay)
  try {
    const cached = localStorage.getItem('maqass_cached_services');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.length > 0) renderServicesDOM(parsed);
    }
  } catch {}

  // 2. Fresh fetch from network
  try {
    const services = await getActiveServices(state.salonSettings?.id);
    localStorage.setItem('maqass_cached_services', JSON.stringify(services));
    renderServicesDOM(services);

    if (services.length === 0) {
      DOM.servicesLoading.style.display = 'none';
      DOM.servicesContainer.style.display = 'block';
      DOM.servicesContainer.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <p>لا توجد خدمات متاحة حالياً.</p>
        </div>
      `;
    }
  } catch (err) {
    DOM.servicesLoading.style.display = 'none';
    if (!state.services || state.services.length === 0) {
      DOM.servicesContainer.style.display = 'block';
      DOM.servicesContainer.innerHTML = `
        <div class="empty-state">
          <p style="color: #ef4444;">${err.message}</p>
        </div>
      `;
    }
  }
}

/**
 * Handles Service Selection
 */
function selectService(service, cardElement) {
  state.selectedService = service;

  // Visual selection toggle
  document.querySelectorAll('.service-card').forEach(el => el.classList.remove('selected'));
  cardElement.classList.add('selected');

  // Enable step 1 continue button
  DOM.btnStep1Next.disabled = false;
  DOM.btnStep1Next.textContent = `متابعة حجز (${service.name}) ←`;
}

/**
 * Initializes Date Constraints using Egypt Local Time
 * (Min = Today, Max = Today + 7 days)
 */
function initDateConstraints() {
  const todayEgyptStr = getEgyptLocalDate();

  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + CONFIG.MAX_DAYS_IN_ADVANCE);
  const maxDateEgyptStr = getEgyptLocalDate(maxDate);

  DOM.bookingDate.min = todayEgyptStr;
  DOM.bookingDate.max = maxDateEgyptStr;
  DOM.bookingDate.value = todayEgyptStr;

  state.selectedDate = todayEgyptStr;
  updateDateLabel(todayEgyptStr);
}

/**
 * Updates the localized Arabic date text under the date picker
 */
function updateDateLabel(dateStr) {
  if (!dateStr) return;
  const friendlyText = formatDateArabic(dateStr);
  DOM.dateLocalizedLabel.textContent = `📅 ${friendlyText}`;
}

/**
 * Loads available slots for selected date and service duration
 */
async function loadAvailableTimeSlots() {
  if (!state.selectedDate || !state.selectedService) return;

  DOM.slotsLoading.style.display = 'block';
  DOM.slotsContainer.style.display = 'none';
  DOM.slotsEmpty.style.display = 'none';
  DOM.btnStep2Next.disabled = true;
  state.selectedSlot = null;

  try {
    const dateObj = new Date(state.selectedDate + 'T00:00:00');
    const dayOfWeek = String(dateObj.getDay());
    
    const workingHoursConfig = state.salonSettings?.working_hours || {};
    const daySchedule = workingHoursConfig[dayOfWeek] || { 
      open: '11:00', 
      close: '23:00', 
      is_off: false 
    };

    if (daySchedule.is_off) {
      DOM.slotsLoading.style.display = 'none';
      DOM.slotsEmpty.style.display = 'block';
      DOM.slotsEmpty.querySelector('p').textContent = `الصالون في عطلة أسبوعية يوم ${ARABIC_DAYS[dayOfWeek]}`;
      return;
    }

    const bookedAppointments = await getBookedSlots(state.selectedDate, state.salonSettings?.id);

    const duration = state.selectedService.duration_minutes || 30;
    const availableSlots = calculateAvailableSlots(
      daySchedule,
      bookedAppointments,
      duration,
      state.selectedDate,
      state.barbers,
      state.selectedBarberId
    );

    DOM.slotsLoading.style.display = 'none';

    if (availableSlots.length === 0) {
      DOM.slotsEmpty.style.display = 'block';
      DOM.slotsContainer.style.display = 'none';
      return;
    }

    DOM.slotsContainer.style.display = 'grid';
    DOM.slotsContainer.innerHTML = '';

    availableSlots.forEach(slot => {
      const chip = document.createElement('div');
      chip.className = 'slot-chip';
      chip.textContent = slot.label;
      chip.dataset.time = slot.time;
      chip.dataset.endTime = slot.endTime;

      chip.addEventListener('click', () => selectSlot(slot, chip));
      DOM.slotsContainer.appendChild(chip);
    });

  } catch (err) {
    DOM.slotsLoading.style.display = 'none';
    showToast(err.message, 'error');
  }
}

/**
 * Handles Time Slot Selection
 */
function selectSlot(slot, chipElement) {
  state.selectedSlot = slot;

  document.querySelectorAll('.slot-chip').forEach(el => el.classList.remove('selected'));
  chipElement.classList.add('selected');

  DOM.btnStep2Next.disabled = false;
  DOM.btnStep2Next.textContent = `تأكيد الميعاد (${slot.label}) ←`;
}

/**
 * Wizard Navigation Controller
 */
function goToStep(stepNumber) {
  if (state.salonSettings?.is_suspended) {
    DOM.bookingContainer.style.display = 'none';
    if (DOM.suspendedBanner) DOM.suspendedBanner.style.display = 'flex';
    showToast('عذراً، الصالون متوقف حالياً ومغلق بقرار من إدارة المنصة 🔒', 'error');
    return;
  }

  state.currentStep = stepNumber;

  DOM.step1.style.display = stepNumber === 1 ? 'block' : 'none';
  DOM.step2.style.display = stepNumber === 2 ? 'block' : 'none';
  DOM.step3.style.display = stepNumber === 3 ? 'block' : 'none';
  DOM.successScreen.style.display = 'none';

  DOM.stepNode1.classList.toggle('active', stepNumber === 1);
  DOM.stepNode1.classList.toggle('completed', stepNumber > 1);

  DOM.stepNode2.classList.toggle('active', stepNumber === 2);
  DOM.stepNode2.classList.toggle('completed', stepNumber > 2);

  DOM.stepNode3.classList.toggle('active', stepNumber === 3);

  window.scrollTo({ top: DOM.bookingContainer.offsetTop - 20, behavior: 'smooth' });
}

/**
 * Updates Summary Display on Step 3
 */
function updateSummaryBox() {
  if (!state.selectedService || !state.selectedSlot) return;

  DOM.summaryServiceName.textContent = state.selectedService.name;
  DOM.summaryDuration.textContent = `${state.selectedService.duration_minutes} دقيقة`;
  DOM.summaryDate.textContent = formatDateArabic(state.selectedDate);
  DOM.summaryTime.textContent = `${state.selectedSlot.label} (حتى ${state.selectedSlot.endLabel})`;

  if (DOM.summaryBarberItem && DOM.summaryBarberName) {
    if (state.selectedSlot.barberName) {
      DOM.summaryBarberItem.style.display = 'flex';
      DOM.summaryBarberName.textContent = state.selectedSlot.barberName;
    } else {
      DOM.summaryBarberItem.style.display = 'none';
    }
  }
}

/**
 * Submits Client Booking to Database
 */
async function handleBookingSubmit(e) {
  e.preventDefault();

  if (state.salonSettings?.is_suspended) {
    showToast('عذراً، هذا الصالون متوقف ومغلق حالياً بقرار من إدارة المنصة 🔒', 'error', 5000);
    DOM.bookingContainer.style.display = 'none';
    if (DOM.suspendedBanner) DOM.suspendedBanner.style.display = 'flex';
    return;
  }

  const name = DOM.clientNameInput.value.trim();
  const phone = DOM.clientPhoneInput.value.trim();

  if (!name) {
    showToast('يرجى كتابة اسمك الكريم.', 'error');
    DOM.clientNameInput.focus();
    return;
  }

  if (!isValidEgyptianPhone(phone)) {
    showToast('يرجى إدخال رقم موبايل مصري صحيح مكون من 11 رقم.', 'error');
    DOM.clientPhoneInput.focus();
    return;
  }

  DOM.btnSubmitBooking.disabled = true;
  DOM.btnSubmitBooking.innerHTML = '<div class="spinner"></div> جاري التحقق...';

  try {
    const { isBlocked } = await checkBlacklist(phone);
    if (isBlocked) {
      DOM.blacklistAlert.style.display = 'flex';
      DOM.btnSubmitBooking.disabled = false;
      DOM.btnSubmitBooking.textContent = 'تأكيد الحجز الآن ✨';
      showToast('عذراً، هذا الرقم محظور من الحجز، يرجى التواصل مع الإدارة.', 'error');
      return;
    }
    DOM.blacklistAlert.style.display = 'none';

    DOM.btnSubmitBooking.innerHTML = '<div class="spinner"></div> جاري تسجيل موعدك...';

    const payload = {
      salon_id: state.salonSettings?.id || null,
      barber_id: state.selectedSlot.barberId || null,
      barber_name: state.selectedSlot.barberName || null,
      service_id: state.selectedService.id,
      client_name: name,
      client_phone: phone,
      appointment_date: state.selectedDate,
      start_time: state.selectedSlot.time,
      end_time: state.selectedSlot.endTime
    };

    const newAppointment = await createAppointment(payload);
    state.createdAppointment = newAppointment;

    localStorage.setItem(CONFIG.STORAGE_KEYS.USER_NAME, name);
    localStorage.setItem(CONFIG.STORAGE_KEYS.USER_PHONE, phone);

    renderSuccessScreen(newAppointment, name, phone);

  } catch (err) {
    DOM.btnSubmitBooking.disabled = false;
    DOM.btnSubmitBooking.textContent = 'تأكيد الحجز الآن ✨';

    if (err.code === 'DOUBLE_BOOKING') {
      showToast(err.message, 'error', 5000);
      goToStep(2);
      await loadAvailableTimeSlots();
      return;
    }

    showToast(err.message, 'error');
  }
}

/**
 * Shows Success Screen with Digital Ticket & WhatsApp Confirmation Button
 */
function renderSuccessScreen(appointment, clientName, clientPhone) {
  DOM.bookingContainer.style.display = 'none';
  DOM.successScreen.style.display = 'block';

  DOM.ticketTime.textContent = formatTime12H(appointment.start_time);
  DOM.ticketClient.textContent = clientName;
  DOM.ticketService.textContent = state.selectedService.name;
  DOM.ticketDate.textContent = formatDateArabic(appointment.appointment_date);

  if (DOM.ticketBarber) {
    const barberName = state.selectedSlot?.barberName || appointment.barbers?.name;
    if (barberName) {
      DOM.ticketBarber.textContent = `💈 الحلاق: ${barberName}`;
      DOM.ticketBarber.style.display = 'block';
    } else {
      DOM.ticketBarber.style.display = 'none';
    }
  }

  const barberPhone = state.salonSettings?.phone || '01000000000';
  const whatsappUrl = generateWhatsAppLink({
    clientPhone: barberPhone,
    clientName: clientName,
    salonName: state.salonSettings?.salon_name || CONFIG.APP_NAME,
    serviceName: state.selectedService.name,
    barberName: state.selectedSlot?.barberName || '',
    date: appointment.appointment_date,
    time: appointment.start_time,
    type: 'confirmation'
  });

  DOM.btnWhatsAppConfirm.href = whatsappUrl;

  showToast('تم تسجيل حجزك بنجاح! نعيماً مقدماً ✨', 'success');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Event Listeners Binding
 */
function setupEventListeners() {
  DOM.btnStep1Next.addEventListener('click', async () => {
    if (!state.selectedService) return;
    DOM.step2ServiceBadge.textContent = `${state.selectedService.name} (${state.selectedService.duration_minutes} دقيقة)`;
    goToStep(2);
    await loadAvailableTimeSlots();
  });

  DOM.bookingDate.addEventListener('change', async (e) => {
    state.selectedDate = e.target.value;
    updateDateLabel(state.selectedDate);
    await loadAvailableTimeSlots();
  });

  DOM.btnStep2Back.addEventListener('click', () => goToStep(1));
  DOM.btnStep2Next.addEventListener('click', () => {
    if (!state.selectedSlot) return;
    updateSummaryBox();
    goToStep(3);
  });

  DOM.btnStep3Back.addEventListener('click', () => goToStep(2));
  DOM.bookingForm.addEventListener('submit', handleBookingSubmit);

  DOM.btnNewBooking.addEventListener('click', () => {
    state.selectedService = null;
    state.selectedSlot = null;
    DOM.btnStep1Next.disabled = true;
    DOM.btnStep1Next.textContent = 'متابعة اختيار الميعاد ←';
    document.querySelectorAll('.service-card').forEach(c => c.classList.remove('selected'));
    goToStep(1);
    DOM.bookingContainer.style.display = 'block';
    DOM.successScreen.style.display = 'none';
  });
}
