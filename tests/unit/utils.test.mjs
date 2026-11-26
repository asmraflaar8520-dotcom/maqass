import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml,
  isValidEgyptianPhone,
  normalizePhoneForWhatsApp,
  getEgyptLocalTimeMinutes,
  calculateAvailableSlots,
  generateWhatsAppLink
} from '../../js/utils.js';

describe('1. escapeHtml XSS Prevention', () => {
  it('should neutralize <script> payload', () => {
    const raw = "<script>alert('xss')</script>";
    const sanitized = escapeHtml(raw);
    assert.equal(sanitized, "&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;");
    assert.equal(sanitized.includes('<script>'), false);
  });

  it('should neutralize <img> onerror payload', () => {
    const raw = '<img src="x" onerror="alert(1)">';
    const sanitized = escapeHtml(raw);
    assert.equal(sanitized, '&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;');
    assert.equal(sanitized.includes('<img'), false);
    assert.equal(sanitized.includes('"'), false);
  });

  it('should neutralize attribute breakout <svg> payload', () => {
    const raw = '"><svg onload=alert(document.cookie)>';
    const sanitized = escapeHtml(raw);
    assert.equal(sanitized, '&quot;&gt;&lt;svg onload=alert(document.cookie)&gt;');
    assert.equal(sanitized.includes('>'), false);
  });

  it('should neutralize mixed dangerous entities and quotes', () => {
    const raw = `javascript:alert(1)&"test"'`;
    const sanitized = escapeHtml(raw);
    assert.equal(sanitized, 'javascript:alert(1)&amp;&quot;test&quot;&#039;');
    assert.equal(sanitized.includes('&"'), false);
  });

  it('should safely handle null, undefined, numbers and empty strings', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
    assert.equal(escapeHtml(''), '');
    assert.equal(escapeHtml(12345), '12345');
  });
});

describe('2. isValidEgyptianPhone Validation', () => {
  it('should validate genuine Egyptian mobile numbers (010, 011, 012, 015)', () => {
    assert.equal(isValidEgyptianPhone('01012345678'), true);
    assert.equal(isValidEgyptianPhone('01123456789'), true);
    assert.equal(isValidEgyptianPhone('01234567890'), true);
    assert.equal(isValidEgyptianPhone('01545678901'), true);
  });

  it('should validate numbers with international prefix and whitespace', () => {
    assert.equal(isValidEgyptianPhone('+201012345678'), true);
    assert.equal(isValidEgyptianPhone('00201123456789'), true);
    assert.equal(isValidEgyptianPhone(' 010 1234 5678 '), true);
    assert.equal(isValidEgyptianPhone('+20 12 3456 7890'), true);
  });

  it('should reject invalid network prefixes (013, 014, 016, etc.)', () => {
    assert.equal(isValidEgyptianPhone('01312345678'), false);
    assert.equal(isValidEgyptianPhone('01412345678'), false);
    assert.equal(isValidEgyptianPhone('01612345678'), false);
    assert.equal(isValidEgyptianPhone('01912345678'), false);
  });

  it('should reject wrong lengths, characters, empty and null inputs', () => {
    assert.equal(isValidEgyptianPhone('0101234567'), false);    // 10 digits
    assert.equal(isValidEgyptianPhone('010123456789'), false);  // 12 digits
    assert.equal(isValidEgyptianPhone('0101234567a'), false);   // non-numeric
    assert.equal(isValidEgyptianPhone(''), false);
    assert.equal(isValidEgyptianPhone(null), false);
    assert.equal(isValidEgyptianPhone(undefined), false);
  });
});

describe('3. normalizePhoneForWhatsApp Formatting', () => {
  it('should normalize standard local Egyptian number to 201xxxxxxxxx', () => {
    assert.equal(normalizePhoneForWhatsApp('01012345678'), '201012345678');
    assert.equal(normalizePhoneForWhatsApp('01198765432'), '201198765432');
  });

  it('should normalize numbers with +20, 0020 and formatting symbols', () => {
    assert.equal(normalizePhoneForWhatsApp('+201012345678'), '201012345678');
    assert.equal(normalizePhoneForWhatsApp('00201012345678'), '201012345678');
    assert.equal(normalizePhoneForWhatsApp('+20 (10) 1234-5678'), '201012345678');
  });

  it('should handle empty or falsy phone gracefully', () => {
    assert.equal(normalizePhoneForWhatsApp(''), '');
    assert.equal(normalizePhoneForWhatsApp(null), '');
    assert.equal(normalizePhoneForWhatsApp(undefined), '');
  });
});

describe('4. getEgyptLocalTimeMinutes Timezone Discipline', () => {
  it('should return exactly 5 minutes for 00:05 Cairo time', () => {
    // 00:05:00 UTC+2 (Cairo winter standard time)
    const midnightPlusFive = new Date('2026-11-20T00:05:00+02:00');
    const minutes = getEgyptLocalTimeMinutes(midnightPlusFive);
    assert.equal(minutes, 5);
  });

  it('should return exactly 0 minutes for 00:00 Cairo midnight (preventing hour 24)', () => {
    const midnight = new Date('2026-11-20T00:00:00+02:00');
    const minutes = getEgyptLocalTimeMinutes(midnight);
    assert.equal(minutes, 0);
  });

  it('should return 1435 minutes for 23:55 Cairo time', () => {
    const lateNight = new Date('2026-11-20T23:55:00+02:00');
    const minutes = getEgyptLocalTimeMinutes(lateNight);
    assert.equal(minutes, 23 * 60 + 55);
  });
});

describe('5. calculateAvailableSlots Multi-Scenario Engine', () => {
  const barbers = [
    { id: 'b1', name: 'كابتن أحمد' },
    { id: 'b2', name: 'كابتن محمود' }
  ];

  it('Scenario 1: Normal Day (يوم عادي) with booked slot excluded', () => {
    const schedule = { open: '10:00', close: '12:00', is_off: false };
    const booked = [
      { start_time: '10:30', end_time: '11:00', barber_id: 'b1', status: 'pending' }
    ];
    const slots = calculateAvailableSlots(
      schedule,
      booked,
      30,
      '2099-01-01',
      [{ id: 'b1', name: 'كابتن أحمد' }],
      'b1'
    );

    const slotTimes = slots.map(s => s.time);
    assert.equal(slotTimes.includes('10:00'), true);
    assert.equal(slotTimes.includes('10:30'), false, 'Booked slot at 10:30 must be excluded');
    assert.equal(slotTimes.includes('11:00'), true);
    assert.equal(slotTimes.includes('11:30'), true);
  });

  it('Scenario 2: Multi-Barber (تعدد حلاقين) Capacity Awareness', () => {
    const schedule = { open: '14:00', close: '15:00', is_off: false };
    const booked = [
      { start_time: '14:00', end_time: '14:30', barber_id: 'b1', status: 'pending' }
    ];

    // When 'any' barber is selected, 14:00 is still available via barber b2
    const anySlots = calculateAvailableSlots(schedule, booked, 30, '2099-01-01', barbers, 'any');
    const slot14 = anySlots.find(s => s.time === '14:00');
    assert.ok(slot14, 'Slot 14:00 should be available with barber 2');
    assert.equal(slot14.barberId, 'b2');

    // When b1 is specifically chosen, 14:00 must NOT be available
    const b1Slots = calculateAvailableSlots(schedule, booked, 30, '2099-01-01', barbers, 'b1');
    assert.equal(b1Slots.some(s => s.time === '14:00'), false);
  });

  it('Scenario 3: Midnight Crossing Working Hours (ساعات عمل بعد منتصف الليل 22:00 إلى 01:00)', () => {
    const schedule = { open: '22:00', close: '01:00', is_off: false };
    const slots = calculateAvailableSlots(
      schedule,
      [],
      30,
      '2099-01-01',
      [{ id: 'b1', name: 'كابتن أحمد' }],
      'any'
    );

    assert.ok(slots.length > 0);

    // Verify boundary slot crossing midnight (23:45 -> 00:15) was excluded to protect DB check constraint
    const crossingSlot = slots.find(s => s.startMinutes < 1440 && s.endMinutes > 1440);
    assert.equal(crossingSlot, undefined, 'Slots crossing midnight boundary must be skipped');

    // Slots after midnight must carry the next calendar day
    const postMidnightSlots = slots.filter(s => s.time < '22:00');
    assert.ok(postMidnightSlots.length > 0);
    for (const s of postMidnightSlots) {
      assert.equal(s.appointmentDate, '2099-01-02', 'Post-midnight slot must belong to next calendar day');
    }
  });

  it('Scenario 4: Day Off (يوم إجازة)', () => {
    const schedule = { open: '10:00', close: '22:00', is_off: true };
    const slots = calculateAvailableSlots(
      schedule,
      [],
      30,
      '2099-01-01',
      barbers,
      'any'
    );
    assert.deepEqual(slots, []);
  });

  it('Scenario 5: Empty Barbers List (قائمة حلاقين فارغة)', () => {
    const schedule = { open: '10:00', close: '22:00', is_off: false };
    const slots = calculateAvailableSlots(
      schedule,
      [],
      30,
      '2099-01-01',
      [],
      'any'
    );
    assert.deepEqual(slots, []);
  });
});

describe('6. generateWhatsAppLink Message Templates', () => {
  it('should generate valid client_to_salon link with all details', () => {
    const link = generateWhatsAppLink({
      clientPhone: '01012345678',
      clientName: 'أحمد علي',
      salonName: 'صالون مِقَصْ',
      serviceName: 'قص شعر',
      barberName: 'الأسطى محمود',
      date: '2026-11-20',
      time: '14:30:00',
      type: 'client_to_salon'
    });

    assert.ok(link.startsWith('https://wa.me/201012345678?text='));
    const decoded = decodeURIComponent(link.split('?text=')[1]);
    assert.ok(decoded.includes('أحمد علي'));
    assert.ok(decoded.includes('صالون مِقَصْ'));
    assert.ok(decoded.includes('قص شعر'));
    assert.ok(decoded.includes('الأسطى محمود'));
    assert.ok(decoded.includes('02:30 م'));
  });

  it('should generate valid confirmation message for salon to client', () => {
    const link = generateWhatsAppLink({
      clientPhone: '01198765432',
      clientName: 'كريم',
      salonName: 'صالون مِقَصْ',
      serviceName: 'تحديد لحية',
      date: '2026-11-20',
      time: '18:00:00',
      type: 'confirmation'
    });

    assert.ok(link.startsWith('https://wa.me/201198765432?text='));
    const decoded = decodeURIComponent(link.split('?text=')[1]);
    assert.ok(decoded.includes('يا هلا يا كريم'));
    assert.ok(decoded.includes('تحديد لحية'));
  });
});
