// =============================================================================
// Maqass (مِقَصْ) — Client Booking Portal Logic (client.js)
// Pure ES6 Browser Module, 100% Free-Tier & GitHub Pages Ready
// Timezone-Safe (Africa/Cairo) & Double-Booking Auto-Recovery
// =============================================================================

import { CONFIG, ARABIC_DAYS } from './config.js';
import { 
  getSalonSettings, 
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
  showToast 
} from './utils.js';

// Application State
const state = {
  currentStep: 1,
  salonSettings: null,
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
  ticketDate: document.getElementById('ticket-date'),
  btnWhatsAppConfirm: document.getElementById('btn-whatsapp-confirm'),
  btnNewBooking: document.getElementById('btn-new-booking')
};

/**
 * Entry Point: Initializes Portal on DOM Ready
 */
document.addEventListener('DOMContentLoaded', async () => {
  initCredentialsModal();
  initStoredClientInfo();
  await initVisitorCounter();
  await loadSalonProfile();
  await loadServices();
  initDateConstraints();
  setupEventListeners();
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
 * Triggers session-guarded atomic visitor count
 */
async function initVisitorCounter() {
  const updatedCount = await triggerVisitorCounter();
  if (updatedCount !== null && DOM.viewsCount) {
    DOM.viewsCount.textContent = Number(updatedCount).toLocaleString('ar-EG');
  }
}

/**
 * Loads and renders salon settings & status
 */
async function loadSalonProfile() {
  try {
    const settings = await getSalonSettings();
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

    // Check operational status
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
  } catch (err) {
    console.warn('Could not load salon settings:', err);
    DOM.salonStatus.textContent = 'صالون الحلاقة متاح للحجز';
  }
}

/**
 * Loads and renders active services catalog
 */
async function loadServices() {
  DOM.servicesLoading.style.display = 'block';
  DOM.servicesContainer.style.display = 'none';

  try {
    const services = await getActiveServices();
    state.services = services;

    DOM.servicesLoading.style.display = 'none';
    DOM.servicesContainer.style.display = 'grid';

    if (services.length === 0) {
      DOM.servicesContainer.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <p>لا توجد خدمات متاحة حالياً.</p>
        </div>
      `;
      return;
    }

    DOM.servicesContainer.innerHTML = '';
    services.forEach(service => {
      const card = document.createElement('div');
      card.className = 'service-card';
      card.dataset.id = service.id;

      card.innerHTML = `
        <div class="service-name">${service.name}</div>
        <div class="service-meta">
          <span>⏱️ ${service.duration_minutes} دقيقة</span>
          <span class="service-price">${Number(service.price).toFixed(0)} ج.م</span>
        </div>
      `;

      card.addEventListener('click', () => selectService(service, card));
      DOM.servicesContainer.appendChild(card);
    });
  } catch (err) {
    DOM.servicesLoading.style.display = 'none';
    DOM.servicesContainer.style.display = 'block';
    DOM.servicesContainer.innerHTML = `
      <div class="empty-state">
        <p style="color: #ef4444;">${err.message}</p>
      </div>
    `;
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

    const bookedAppointments = await getBookedSlots(state.selectedDate);

    const duration = state.selectedService.duration_minutes || 30;
    const availableSlots = calculateAvailableSlots(
      daySchedule,
      bookedAppointments,
      duration,
      state.selectedDate
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
}

/**
 * Submits Client Booking to Database
 */
async function handleBookingSubmit(e) {
  e.preventDefault();

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

  const barberPhone = state.salonSettings?.phone || '01000000000';
  const whatsappUrl = generateWhatsAppLink({
    clientPhone: barberPhone,
    clientName: clientName,
    salonName: state.salonSettings?.salon_name || CONFIG.APP_NAME,
    serviceName: state.selectedService.name,
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
