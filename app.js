/*
 * Device Payment Calculator V3
 *
 * This script powers a mobile-first quote builder for devices and accessories.
 * It supports manually entering phone and watch details and calculating
 * financing totals for due today, monthly payments, and pay in full. Accessories
 * are never financed but can optionally be included in the headline totals.
 */

const TERM = 24;
const DISCOUNT = 0.30;
const PREFS_KEY = 'device_calc_v3_prefs';

const $ = (id) => document.getElementById(id);

const els = {
  accEligible: $('accEligible'),
  accNoDisc: $('accNoDisc'),
  aarpUsaa: $('aarpUsaa'),
  enablePhone: $('enablePhone'),
  enableWatch: $('enableWatch'),
  phoneCard: $('phoneCard'),
  watchCard: $('watchCard'),
  phoneFields: $('phoneFields'),
  watchFields: $('watchFields'),
  phoneName: $('phoneName'),
  watchName: $('watchName'),
  phoneRetail: $('phoneRetail'),
  watchRetail: $('watchRetail'),
  taxRate: $('taxRate'),
  addAccToDue: $('addAccToDue'),
  addAccToFull: $('addAccToFull'),
  calcBtn: $('calcBtn'),
  copyBtn: $('copyBtn'),
  resetBtn: $('resetBtn'),
  errBox: $('errBox'),
  summary: $('summary'),
  stickyQuote: $('stickyQuote'),
  jumpSummaryBtn: $('jumpSummaryBtn'),
  themeBtn: $('themeBtn'),
  quoteMode: $('quoteMode'),
  phoneDetails: $('phoneDetails'),
  watchDetails: $('watchDetails'),
  comboDetails: $('comboDetails'),
  watchNote: $('watchNote')
};

let timer = null;
let hasCalculated = false;

function money(n) {
  if (!Number.isFinite(n)) n = 0;
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function ceil2(n) {
  return Math.ceil(n * 100) / 100;
}

function sanitizeMoneyInput(input) {
  const raw = input.value;
  let cleaned = raw.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot !== -1) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
  }
  const parts = cleaned.split('.');
  if (parts.length === 2) {
    cleaned = parts[0] + '.' + parts[1].slice(0, 2);
  }
  if (cleaned !== raw) {
    input.value = cleaned;
  }
}

function parseMoney(input) {
  const n = parseFloat((input.value || '').trim());
  return Number.isFinite(n) ? n : 0;
}

function showError(msg) {
  els.errBox.style.display = 'block';
  els.errBox.textContent = msg;
}

function clearError() {
  els.errBox.style.display = 'none';
  els.errBox.textContent = '';
}

function phoneDown(retailWhole) {
  let down = ((retailWhole % TERM) + TERM) % TERM;
  if (down < 11) down += TERM;
  return down;
}

function buildModeLabel(state) {
  const parts = [];
  if (state.devices.phone.enabled && state.devices.phone.retail > 0) parts.push('Phone');
  if (state.devices.watch.enabled && state.devices.watch.retail > 0) parts.push('Watch');
  if (state.accessories.eligible > 0 || state.accessories.noDiscount > 0) parts.push('Accessories');
  return parts.length ? parts.join(' + ') : 'Ready to build quote';
}

function updateModeChip() {
  const state = readState();
  els.quoteMode.textContent = buildModeLabel(state);
}

function savePrefs() {
  const prefs = {
    taxRate: els.taxRate.value,
    addAccToDue: els.addAccToDue.checked,
    addAccToFull: els.addAccToFull.checked,
    themeDark: document.body.classList.contains('dark')
  };

  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (err) {
    // ignore storage errors
  }
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return;
    const prefs = JSON.parse(raw);

    if (typeof prefs.taxRate === 'string') els.taxRate.value = prefs.taxRate;
    els.addAccToDue.checked = !!prefs.addAccToDue;
    els.addAccToFull.checked = !!prefs.addAccToFull;
    document.body.classList.toggle('dark', !!prefs.themeDark);
    els.themeBtn.textContent = document.body.classList.contains('dark') ? '☀️' : '🌙';
  } catch (err) {
    // ignore parsing errors
  }
}

function setDeviceVisibility() {
  const phoneOn = els.enablePhone.checked;
  const watchOn = els.enableWatch.checked;

  els.phoneFields.hidden = !phoneOn;
  els.watchFields.hidden = !watchOn;
  els.phoneCard.classList.toggle('active', phoneOn);
  els.watchCard.classList.toggle('active', watchOn);

  if (!phoneOn) {
    els.phoneName.value = '';
    els.phoneRetail.value = '';
  }

  if (!watchOn) {
    els.watchName.value = '';
    els.watchRetail.value = '';
  }

  updateModeChip();
}

function readState() {
  return {
    accessories: {
      eligible: round2(parseMoney(els.accEligible)),
      noDiscount: round2(parseMoney(els.accNoDisc)),
      discountEnabled: els.aarpUsaa.checked
    },
    devices: {
      phone: {
        enabled: els.enablePhone.checked,
        name: (els.phoneName.value || '').trim() || 'Custom phone',
        retail: round2(parseMoney(els.phoneRetail))
      },
      watch: {
        enabled: els.enableWatch.checked,
        name: (els.watchName.value || '').trim() || 'Custom watch',
        retail: round2(parseMoney(els.watchRetail))
      }
    },
    taxRate: parseFloat(els.taxRate.value || '0'),
    addAccToDue: els.addAccToDue.checked,
    addAccToFull: els.addAccToFull.checked
  };
}

function calcAccessories(accessories, taxRate) {
  const eligible = round2(accessories.eligible);
  const noDiscount = round2(accessories.noDiscount);
  const discount = accessories.discountEnabled && eligible > 0 ? round2(eligible * DISCOUNT) : 0;
  const eligibleAfter = round2(eligible - discount);
  const subtotal = round2(eligibleAfter + noDiscount);
  const tax = round2(subtotal * (taxRate / 100));
  const due = round2(subtotal + tax);

  return { eligible, noDiscount, discount, eligibleAfter, subtotal, tax, due };
}

function calcPhone(device, taxRate) {
  const retail = Math.round(device.retail);
  const down = phoneDown(retail);
  const balance = retail - down;
  const monthly = balance / TERM;
  const tax = round2(retail * (taxRate / 100));
  const due = round2(down + tax);
  const full = round2(retail + tax);

  return {
    type: 'phone',
    name: device.name,
    retail,
    down,
    balance,
    monthly,
    tax,
    due,
    full,
    note: ''
  };
}

function calcWatch(device, taxRate) {
  const retail = round2(device.retail);
  const down = 0;
  const balance = retail;
  const monthly = ceil2(balance / TERM);
  const tax = round2(retail * (taxRate / 100));
  const due = round2(down + tax);
  const full = round2(retail + tax);
  const shown = round2(monthly * TERM);
  const diff = round2(shown - retail);
  const note = diff >= 0.01
    ? `Watch monthly is rounded up. Last payment adjusts by ${money(diff)} to match retail.`
    : '';

  return {
    type: 'watch',
    name: device.name,
    retail,
    down,
    balance,
    monthly,
    tax,
    due,
    full,
    note
  };
}

function calcQuote(state) {
  if (!Number.isFinite(state.taxRate) || state.taxRate < 0 || state.taxRate > 100) {
    return { error: 'Tax rate must be between 0% and 100%.' };
  }

  const accessories = calcAccessories(state.accessories, state.taxRate);
  const activeDevices = [];

  if (state.devices.phone.enabled && state.devices.phone.retail > 0) {
    activeDevices.push(calcPhone(state.devices.phone, state.taxRate));
  }

  if (state.devices.watch.enabled && state.devices.watch.retail > 0) {
    activeDevices.push(calcWatch(state.devices.watch, state.taxRate));
  }

  const deviceTotals = activeDevices.reduce((sum, device) => ({
    retail: round2(sum.retail + device.retail),
    monthly: round2(sum.monthly + device.monthly),
    tax: round2(sum.tax + device.tax),
    due: round2(sum.due + device.due),
    full: round2(sum.full + device.full)
  }), { retail: 0, monthly: 0, tax: 0, due: 0, full: 0 });

  const hasAccessories = accessories.subtotal > 0;
  const deviceCount = activeDevices.length;
  const hasAnything = hasAccessories || deviceCount > 0;

  if (!hasAnything) {
    return {
      error: '',
      hasAnything: false,
      accessories,
      activeDevices,
      deviceTotals,
      finalDue: 0,
      finalFull: 0,
      dueLabel: '—',
      fullLabel: '—'
    };
  }

  let finalDue = deviceTotals.due;
  let finalFull = deviceTotals.full;
  let dueLabel = '—';
  let fullLabel = '—';

  if (deviceCount === 0 && hasAccessories) {
    finalDue = accessories.due;
    finalFull = accessories.due;
    dueLabel = 'Accessories only';
    fullLabel = 'Accessories only';
  } else {
    const baseLabel = deviceCount === 2
      ? 'Phone + watch'
      : activeDevices[0].type === 'phone'
        ? 'Phone only'
        : 'Watch only';

    if (hasAccessories && state.addAccToDue) finalDue = round2(finalDue + accessories.due);
    if (hasAccessories && state.addAccToFull) finalFull = round2(finalFull + accessories.due);

    dueLabel = hasAccessories && state.addAccToDue ? `${baseLabel} + accessories` : baseLabel;
    fullLabel = hasAccessories && state.addAccToFull ? `${baseLabel} + accessories` : baseLabel;
  }

  return {
    error: '',
    hasAnything: true,
    accessories,
    activeDevices,
    deviceTotals,
    finalDue,
    finalFull,
    dueLabel,
    fullLabel,
    selectedDueTotal: finalDue,
    selectedFullTotal: finalFull
  };
}

function render(result) {
  clearError();

  if (result.error) {
    showError(result.error);
    els.summary.hidden = true;
    els.stickyQuote.hidden = true;
    return;
  }

  $('bElig').textContent = money(result.accessories.eligible);
  $('bDisc').textContent = money(result.accessories.discount);
  $('bEligAfter').textContent = money(result.accessories.eligibleAfter);
  $('bNoDisc').textContent = money(result.accessories.noDiscount);
  $('bAccSub').textContent = money(result.accessories.subtotal);
  $('bAccTax').textContent = money(result.accessories.tax);
  $('bAccDue').textContent = money(result.accessories.due);

  if (!result.hasAnything) {
    els.summary.hidden = true;
    els.stickyQuote.hidden = true;
    els.phoneDetails.hidden = true;
    els.watchDetails.hidden = true;
    els.comboDetails.hidden = true;
    return;
  }

  const phone = result.activeDevices.find((device) => device.type === 'phone');
  const watch = result.activeDevices.find((device) => device.type === 'watch');

  if (phone) {
    $('pName').textContent = phone.name;
    $('pRetail').textContent = money(phone.retail);
    $('pDown').textContent = money(phone.down);
    $('pBal').textContent = money(phone.balance);
    $('pMonthly').textContent = money(phone.monthly);
    $('pTax').textContent = money(phone.tax);
    $('pDue').textContent = money(phone.due);
    $('pFull').textContent = money(phone.full);
    els.phoneDetails.hidden = false;
  } else {
    els.phoneDetails.hidden = true;
  }

  if (watch) {
    $('wName').textContent = watch.name;
    $('wRetail').textContent = money(watch.retail);
    $('wDown').textContent = money(watch.down);
    $('wBal').textContent = money(watch.balance);
    $('wMonthly').textContent = money(watch.monthly);
    $('wTax').textContent = money(watch.tax);
    $('wDue').textContent = money(watch.due);
    $('wFull').textContent = money(watch.full);
    els.watchNote.textContent = watch.note;
    els.watchNote.style.display = watch.note ? 'block' : 'none';
    els.watchDetails.hidden = false;
  } else {
    els.watchNote.textContent = '';
    els.watchNote.style.display = 'none';
    els.watchDetails.hidden = true;
  }

  if (result.activeDevices.length > 0) {
    $('cCount').textContent = String(result.activeDevices.length);
    $('cRetail').textContent = money(result.deviceTotals.retail);
    $('cMonthly').textContent = money(result.deviceTotals.monthly);
    $('cTax').textContent = money(result.deviceTotals.tax);
    $('cDue').textContent = money(result.deviceTotals.due);
    $('cFull').textContent = money(result.deviceTotals.full);
    $('cSelectedDue').textContent = money(result.selectedDueTotal);
    $('cSelectedFull').textContent = money(result.selectedFullTotal);
    els.comboDetails.hidden = false;
  } else {
    els.comboDetails.hidden = true;
  }

  $('qDue').textContent = money(result.finalDue);
  $('qDueSub').textContent = result.dueLabel;
  $('qMonthly').textContent = money(result.deviceTotals.monthly);
  $('qMonthlySub').textContent = result.activeDevices.length > 0 ? 'Devices only' : 'No financed device';
  $('qFull').textContent = money(result.finalFull);
  $('qFullSub').textContent = result.fullLabel;

  $('stickyDue').textContent = money(result.finalDue);
  $('stickyMonthly').textContent = money(result.deviceTotals.monthly);
  $('stickyLabel').textContent = result.dueLabel || 'Tap to view full quote';

  els.summary.hidden = false;
  els.stickyQuote.hidden = false;
}

function calculate(userInitiated = false) {
  const state = readState();
  const result = calcQuote(state);

  if (userInitiated) {
    if (state.devices.phone.enabled && state.devices.phone.retail > 0) {
      els.phoneRetail.value = String(Math.round(state.devices.phone.retail));
    }
    if (state.devices.watch.enabled && state.devices.watch.retail > 0) {
      els.watchRetail.value = round2(state.devices.watch.retail).toFixed(2);
    }
  }

  render(result);
  updateModeChip();
  savePrefs();
  hasCalculated = true;
}

function queueRecalc() {
  updateModeChip();
  savePrefs();
  if (!hasCalculated) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => calculate(false), 180);
}

function resetAll() {
  els.accEligible.value = '';
  els.accNoDisc.value = '';
  els.aarpUsaa.checked = false;
  els.enablePhone.checked = false;
  els.enableWatch.checked = false;
  els.phoneName.value = '';
  els.watchName.value = '';
  els.phoneRetail.value = '';
  els.watchRetail.value = '';
  els.taxRate.value = '8.9';
  els.addAccToDue.checked = false;
  els.addAccToFull.checked = false;
  setDeviceVisibility();
  clearError();
  els.summary.hidden = true;
  els.stickyQuote.hidden = true;
  els.phoneDetails.hidden = true;
  els.watchDetails.hidden = true;
  els.comboDetails.hidden = true;
  els.watchNote.textContent = '';
  els.watchNote.style.display = 'none';
  hasCalculated = false;
  updateModeChip();
  savePrefs();
}

function copySummary() {
  if (els.summary.hidden) return;

  const lines = [
    'Quote Summary',
    `Due Today: ${$('qDue').textContent}`,
    `Monthly Payment: ${$('qMonthly').textContent}`,
    `Pay in Full Today: ${$('qFull').textContent}`,
    `Due Today Note: ${$('qDueSub').textContent}`,
    `Pay in Full Note: ${$('qFullSub').textContent}`,
    '',
    'Accessories',
    `Eligible: ${$('bElig').textContent}`,
    `Discount: ${$('bDisc').textContent}`,
    `Eligible After: ${$('bEligAfter').textContent}`,
    `No-Discount: ${$('bNoDisc').textContent}`,
    `Accessories Subtotal: ${$('bAccSub').textContent}`,
    `Accessory Tax: ${$('bAccTax').textContent}`,
    `Accessories Due Today: ${$('bAccDue').textContent}`
  ];

  if (!els.phoneDetails.hidden) {
    lines.push('', 'Phone');
    lines.push(`Name: ${$('pName').textContent}`);
    lines.push(`Retail: ${$('pRetail').textContent}`);
    lines.push(`Down: ${$('pDown').textContent}`);
    lines.push(`Balance: ${$('pBal').textContent}`);
    lines.push(`Monthly: ${$('pMonthly').textContent}`);
    lines.push(`Tax: ${$('pTax').textContent}`);
    lines.push(`Due Today: ${$('pDue').textContent}`);
    lines.push(`Pay in Full: ${$('pFull').textContent}`);
  }

  if (!els.watchDetails.hidden) {
    lines.push('', 'Watch');
    lines.push(`Name: ${$('wName').textContent}`);
    lines.push(`Retail: ${$('wRetail').textContent}`);
    lines.push(`Down: ${$('wDown').textContent}`);
    lines.push(`Balance: ${$('wBal').textContent}`);
    lines.push(`Monthly: ${$('wMonthly').textContent}`);
    lines.push(`Tax: ${$('wTax').textContent}`);
    lines.push(`Due Today: ${$('wDue').textContent}`);
    lines.push(`Pay in Full: ${$('wFull').textContent}`);
    if (els.watchNote.textContent) lines.push(`Note: ${els.watchNote.textContent}`);
  }

  if (!els.comboDetails.hidden) {
    lines.push('', 'Combined Devices');
    lines.push(`Devices Added: ${$('cCount').textContent}`);
    lines.push(`Total Device Retail: ${$('cRetail').textContent}`);
    lines.push(`Total Monthly: ${$('cMonthly').textContent}`);
    lines.push(`Total Device Tax: ${$('cTax').textContent}`);
    lines.push(`Devices Due Today: ${$('cDue').textContent}`);
    lines.push(`Devices Pay in Full: ${$('cFull').textContent}`);
    lines.push(`Selected Due Total: ${$('cSelectedDue').textContent}`);
    lines.push(`Selected Full Total: ${$('cSelectedFull').textContent}`);
  }

  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    els.copyBtn.textContent = 'Copied!';
    setTimeout(() => {
      els.copyBtn.textContent = 'Copy Summary';
    }, 1000);
  }).catch(() => {
    showError('Copy failed. Try again or long-press to copy on your device.');
  });
}

function bindMoneyInput(input) {
  input.addEventListener('input', () => {
    sanitizeMoneyInput(input);
    queueRecalc();
  });

  input.addEventListener('blur', queueRecalc);
}

function bindEvents() {
  [els.accEligible, els.accNoDisc, els.phoneRetail, els.watchRetail].forEach(bindMoneyInput);

  els.phoneName.addEventListener('input', () => {
    updateModeChip();
    queueRecalc();
  });

  els.watchName.addEventListener('input', () => {
    updateModeChip();
    queueRecalc();
  });

  els.taxRate.addEventListener('input', queueRecalc);
  els.taxRate.addEventListener('blur', queueRecalc);

  [els.aarpUsaa, els.addAccToDue, els.addAccToFull].forEach((el) => {
    el.addEventListener('change', queueRecalc);
  });

  els.enablePhone.addEventListener('change', () => {
    setDeviceVisibility();
    queueRecalc();
  });

  els.enableWatch.addEventListener('change', () => {
    setDeviceVisibility();
    queueRecalc();
  });

  els.calcBtn.addEventListener('click', () => calculate(true));
  els.copyBtn.addEventListener('click', copySummary);
  els.resetBtn.addEventListener('click', resetAll);

  els.jumpSummaryBtn.addEventListener('click', () => {
    els.summary.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  els.themeBtn.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    els.themeBtn.textContent = document.body.classList.contains('dark') ? '☀️' : '🌙';
    savePrefs();
  });
}

function init() {
  bindEvents();
  loadPrefs();
  setDeviceVisibility();
  updateModeChip();
}

init();