/*
 * Device Payment Calculator V3
 *
 * Polished/refactored version:
 * - same quote math
 * - cleaner DOM caching
 * - safer theme handling
 * - reduced repeated lookups
 * - small copy fallback
 * - same behavior, cleaner structure
 */

const TERM = 24;
const DISCOUNT = 0.30;
const PREFS_KEY = "device_calc_v3_prefs";
const DEBOUNCE_MS = 180;

const $ = (id) => document.getElementById(id);

const els = {
  accEligible: $("accEligible"),
  accNoDisc: $("accNoDisc"),
  aarpUsaa: $("aarpUsaa"),

  enablePhone: $("enablePhone"),
  enableWatch: $("enableWatch"),
  phoneCard: $("phoneCard"),
  watchCard: $("watchCard"),
  phoneFields: $("phoneFields"),
  watchFields: $("watchFields"),
  phoneName: $("phoneName"),
  watchName: $("watchName"),
  phoneRetail: $("phoneRetail"),
  watchRetail: $("watchRetail"),

  taxRate: $("taxRate"),
  addAccToDue: $("addAccToDue"),
  addAccToFull: $("addAccToFull"),

  calcBtn: $("calcBtn"),
  copyBtn: $("copyBtn"),
  resetBtn: $("resetBtn"),
  errBox: $("errBox"),

  summary: $("summary"),
  stickyQuote: $("stickyQuote"),
  jumpSummaryBtn: $("jumpSummaryBtn"),
  themeBtn: $("themeBtn"),
  quoteMode: $("quoteMode"),

  qDue: $("qDue"),
  qDueSub: $("qDueSub"),
  qMonthly: $("qMonthly"),
  qMonthlySub: $("qMonthlySub"),
  qFull: $("qFull"),
  qFullSub: $("qFullSub"),

  stickyDue: $("stickyDue"),
  stickyMonthly: $("stickyMonthly"),
  stickyLabel: $("stickyLabel"),

  bElig: $("bElig"),
  bDisc: $("bDisc"),
  bEligAfter: $("bEligAfter"),
  bNoDisc: $("bNoDisc"),
  bAccSub: $("bAccSub"),
  bAccTax: $("bAccTax"),
  bAccDue: $("bAccDue"),

  phoneDetails: $("phoneDetails"),
  pName: $("pName"),
  pRetail: $("pRetail"),
  pDown: $("pDown"),
  pBal: $("pBal"),
  pMonthly: $("pMonthly"),
  pTax: $("pTax"),
  pDue: $("pDue"),
  pFull: $("pFull"),

  watchDetails: $("watchDetails"),
  wName: $("wName"),
  wRetail: $("wRetail"),
  wDown: $("wDown"),
  wBal: $("wBal"),
  wMonthly: $("wMonthly"),
  wTax: $("wTax"),
  wDue: $("wDue"),
  wFull: $("wFull"),
  watchNote: $("watchNote"),

  comboDetails: $("comboDetails"),
  cCount: $("cCount"),
  cRetail: $("cRetail"),
  cMonthly: $("cMonthly"),
  cTax: $("cTax"),
  cDue: $("cDue"),
  cFull: $("cFull"),
  cSelectedDue: $("cSelectedDue"),
  cSelectedFull: $("cSelectedFull")
};

let timer = null;
let hasCalculated = false;

function money(n) {
  if (!Number.isFinite(n)) n = 0;

  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
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

function setText(el, value) {
  if (el.textContent !== value) {
    el.textContent = value;
  }
}

function setHidden(el, hidden) {
  el.hidden = hidden;
}

function setThemeIcon() {
  els.themeBtn.textContent = document.body.classList.contains("dark") ? "☀️" : "🌙";
}

function applyTheme(isDark) {
  document.body.classList.toggle("dark", isDark);
  setThemeIcon();
}

function sanitizeMoneyInput(input) {
  const raw = input.value;
  let cleaned = raw.replace(/[^0-9.]/g, "");

  const firstDot = cleaned.indexOf(".");
  if (firstDot !== -1) {
    cleaned =
      cleaned.slice(0, firstDot + 1) +
      cleaned.slice(firstDot + 1).replace(/\./g, "");
  }

  const parts = cleaned.split(".");
  if (parts.length === 2) {
    cleaned = `${parts[0]}.${parts[1].slice(0, 2)}`;
  }

  if (cleaned !== raw) {
    input.value = cleaned;
  }
}

function parseMoney(input) {
  const n = parseFloat((input.value || "").trim());
  return Number.isFinite(n) ? n : 0;
}

function showError(msg) {
  els.errBox.style.display = "block";
  els.errBox.textContent = msg;
}

function clearError() {
  els.errBox.style.display = "none";
  els.errBox.textContent = "";
}

function phoneDown(retailWhole) {
  let down = ((retailWhole % TERM) + TERM) % TERM;
  if (down < 11) down += TERM;
  return down;
}

function buildModeLabel(state) {
  const parts = [];

  if (state.devices.phone.enabled && state.devices.phone.retail > 0) parts.push("Phone");
  if (state.devices.watch.enabled && state.devices.watch.retail > 0) parts.push("Watch");
  if (state.accessories.eligible > 0 || state.accessories.noDiscount > 0) parts.push("Accessories");

  return parts.length ? parts.join(" + ") : "Ready to build quote";
}

function updateModeChip() {
  const state = readState();
  setText(els.quoteMode, buildModeLabel(state));
}

function savePrefs() {
  const prefs = {
    taxRate: els.taxRate.value,
    addAccToDue: els.addAccToDue.checked,
    addAccToFull: els.addAccToFull.checked,
    themeDark: document.body.classList.contains("dark")
  };

  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage errors
  }
}

function loadPrefs() {
  let savedPrefs = null;

  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      savedPrefs = JSON.parse(raw);
    }
  } catch {
    savedPrefs = null;
  }

  if (savedPrefs) {
    if (typeof savedPrefs.taxRate === "string") {
      els.taxRate.value = savedPrefs.taxRate;
    }

    els.addAccToDue.checked = !!savedPrefs.addAccToDue;
    els.addAccToFull.checked = !!savedPrefs.addAccToFull;

    if (typeof savedPrefs.themeDark === "boolean") {
      applyTheme(savedPrefs.themeDark);
      return;
    }
  }

  const prefersDark =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;

  applyTheme(!!prefersDark);
}

function resetSummaryUI() {
  setHidden(els.summary, true);
  setHidden(els.stickyQuote, true);
  setHidden(els.phoneDetails, true);
  setHidden(els.watchDetails, true);
  setHidden(els.comboDetails, true);
  setText(els.watchNote, "");
  els.watchNote.style.display = "none";
}

function setDeviceVisibility() {
  const phoneOn = els.enablePhone.checked;
  const watchOn = els.enableWatch.checked;

  setHidden(els.phoneFields, !phoneOn);
  setHidden(els.watchFields, !watchOn);

  els.phoneCard.classList.toggle("active", phoneOn);
  els.watchCard.classList.toggle("active", watchOn);

  if (!phoneOn) {
    els.phoneName.value = "";
    els.phoneRetail.value = "";
  }

  if (!watchOn) {
    els.watchName.value = "";
    els.watchRetail.value = "";
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
        name: (els.phoneName.value || "").trim() || "Custom phone",
        retail: round2(parseMoney(els.phoneRetail))
      },
      watch: {
        enabled: els.enableWatch.checked,
        name: (els.watchName.value || "").trim() || "Custom watch",
        retail: round2(parseMoney(els.watchRetail))
      }
    },
    taxRate: parseFloat(els.taxRate.value || "0"),
    addAccToDue: els.addAccToDue.checked,
    addAccToFull: els.addAccToFull.checked
  };
}

function calcAccessories(accessories, taxRate) {
  const eligible = round2(accessories.eligible);
  const noDiscount = round2(accessories.noDiscount);
  const discount =
    accessories.discountEnabled && eligible > 0
      ? round2(eligible * DISCOUNT)
      : 0;
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
    type: "phone",
    name: device.name,
    retail,
    down,
    balance,
    monthly,
    tax,
    due,
    full,
    note: ""
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

  const note =
    diff >= 0.01
      ? `Watch monthly is rounded up. Last payment adjusts by ${money(diff)} to match retail.`
      : "";

  return {
    type: "watch",
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
    return { error: "Tax rate must be between 0% and 100%." };
  }

  const accessories = calcAccessories(state.accessories, state.taxRate);
  const activeDevices = [];

  if (state.devices.phone.enabled && state.devices.phone.retail > 0) {
    activeDevices.push(calcPhone(state.devices.phone, state.taxRate));
  }

  if (state.devices.watch.enabled && state.devices.watch.retail > 0) {
    activeDevices.push(calcWatch(state.devices.watch, state.taxRate));
  }

  const deviceTotals = activeDevices.reduce(
    (sum, device) => ({
      retail: round2(sum.retail + device.retail),
      monthly: round2(sum.monthly + device.monthly),
      tax: round2(sum.tax + device.tax),
      due: round2(sum.due + device.due),
      full: round2(sum.full + device.full)
    }),
    { retail: 0, monthly: 0, tax: 0, due: 0, full: 0 }
  );

  const hasAccessories = accessories.subtotal > 0;
  const deviceCount = activeDevices.length;
  const hasAnything = hasAccessories || deviceCount > 0;

  if (!hasAnything) {
    return {
      error: "",
      hasAnything: false,
      accessories,
      activeDevices,
      deviceTotals,
      finalDue: 0,
      finalFull: 0,
      dueLabel: "—",
      fullLabel: "—"
    };
  }

  let finalDue = deviceTotals.due;
  let finalFull = deviceTotals.full;
  let dueLabel = "—";
  let fullLabel = "—";

  if (deviceCount === 0 && hasAccessories) {
    finalDue = accessories.due;
    finalFull = accessories.due;
    dueLabel = "Accessories only";
    fullLabel = "Accessories only";
  } else {
    const baseLabel =
      deviceCount === 2
        ? "Phone + watch"
        : activeDevices[0].type === "phone"
          ? "Phone only"
          : "Watch only";

    if (hasAccessories && state.addAccToDue) {
      finalDue = round2(finalDue + accessories.due);
    }

    if (hasAccessories && state.addAccToFull) {
      finalFull = round2(finalFull + accessories.due);
    }

    dueLabel =
      hasAccessories && state.addAccToDue
        ? `${baseLabel} + accessories`
        : baseLabel;

    fullLabel =
      hasAccessories && state.addAccToFull
        ? `${baseLabel} + accessories`
        : baseLabel;
  }

  return {
    error: "",
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
    resetSummaryUI();
    showError(result.error);
    return;
  }

  setText(els.bElig, money(result.accessories.eligible));
  setText(els.bDisc, money(result.accessories.discount));
  setText(els.bEligAfter, money(result.accessories.eligibleAfter));
  setText(els.bNoDisc, money(result.accessories.noDiscount));
  setText(els.bAccSub, money(result.accessories.subtotal));
  setText(els.bAccTax, money(result.accessories.tax));
  setText(els.bAccDue, money(result.accessories.due));

  if (!result.hasAnything) {
    resetSummaryUI();
    return;
  }

  const phone = result.activeDevices.find((device) => device.type === "phone");
  const watch = result.activeDevices.find((device) => device.type === "watch");

  if (phone) {
    setText(els.pName, phone.name);
    setText(els.pRetail, money(phone.retail));
    setText(els.pDown, money(phone.down));
    setText(els.pBal, money(phone.balance));
    setText(els.pMonthly, money(phone.monthly));
    setText(els.pTax, money(phone.tax));
    setText(els.pDue, money(phone.due));
    setText(els.pFull, money(phone.full));
    setHidden(els.phoneDetails, false);
  } else {
    setHidden(els.phoneDetails, true);
  }

  if (watch) {
    setText(els.wName, watch.name);
    setText(els.wRetail, money(watch.retail));
    setText(els.wDown, money(watch.down));
    setText(els.wBal, money(watch.balance));
    setText(els.wMonthly, money(watch.monthly));
    setText(els.wTax, money(watch.tax));
    setText(els.wDue, money(watch.due));
    setText(els.wFull, money(watch.full));
    setText(els.watchNote, watch.note);
    els.watchNote.style.display = watch.note ? "block" : "none";
    setHidden(els.watchDetails, false);
  } else {
    setText(els.watchNote, "");
    els.watchNote.style.display = "none";
    setHidden(els.watchDetails, true);
  }

  if (result.activeDevices.length > 0) {
    setText(els.cCount, String(result.activeDevices.length));
    setText(els.cRetail, money(result.deviceTotals.retail));
    setText(els.cMonthly, money(result.deviceTotals.monthly));
    setText(els.cTax, money(result.deviceTotals.tax));
    setText(els.cDue, money(result.deviceTotals.due));
    setText(els.cFull, money(result.deviceTotals.full));
    setText(els.cSelectedDue, money(result.selectedDueTotal));
    setText(els.cSelectedFull, money(result.selectedFullTotal));
    setHidden(els.comboDetails, false);
  } else {
    setHidden(els.comboDetails, true);
  }

  setText(els.qDue, money(result.finalDue));
  setText(els.qDueSub, result.dueLabel);
  setText(els.qMonthly, money(result.deviceTotals.monthly));
  setText(
    els.qMonthlySub,
    result.activeDevices.length > 0 ? "Devices only" : "No financed device"
  );
  setText(els.qFull, money(result.finalFull));
  setText(els.qFullSub, result.fullLabel);

  setText(els.stickyDue, money(result.finalDue));
  setText(els.stickyMonthly, money(result.deviceTotals.monthly));
  setText(els.stickyLabel, result.dueLabel || "Tap to view full quote");

  setHidden(els.summary, false);
  setHidden(els.stickyQuote, false);
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
  timer = setTimeout(() => calculate(false), DEBOUNCE_MS);
}

function resetAll() {
  els.accEligible.value = "";
  els.accNoDisc.value = "";
  els.aarpUsaa.checked = false;
  els.enablePhone.checked = false;
  els.enableWatch.checked = false;
  els.phoneName.value = "";
  els.watchName.value = "";
  els.phoneRetail.value = "";
  els.watchRetail.value = "";
  els.taxRate.value = "8.9";
  els.addAccToDue.checked = false;
  els.addAccToFull.checked = false;

  setDeviceVisibility();
  clearError();
  resetSummaryUI();

  hasCalculated = false;
  updateModeChip();
  savePrefs();
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const temp = document.createElement("textarea");
  temp.value = text;
  temp.setAttribute("readonly", "");
  temp.style.position = "absolute";
  temp.style.left = "-9999px";
  document.body.appendChild(temp);
  temp.select();
  document.execCommand("copy");
  document.body.removeChild(temp);
}

function copySummary() {
  if (els.summary.hidden) return;

  const lines = [
    "Quote Summary",
    `Due Today: ${els.qDue.textContent}`,
    `Monthly Payment: ${els.qMonthly.textContent}`,
    `Pay in Full Today: ${els.qFull.textContent}`,
    `Due Today Note: ${els.qDueSub.textContent}`,
    `Pay in Full Note: ${els.qFullSub.textContent}`,
    "",
    "Accessories",
    `Eligible: ${els.bElig.textContent}`,
    `Discount: ${els.bDisc.textContent}`,
    `Eligible After: ${els.bEligAfter.textContent}`,
    `No-Discount: ${els.bNoDisc.textContent}`,
    `Accessories Subtotal: ${els.bAccSub.textContent}`,
    `Accessory Tax: ${els.bAccTax.textContent}`,
    `Accessories Due Today: ${els.bAccDue.textContent}`
  ];

  if (!els.phoneDetails.hidden) {
    lines.push("", "Phone");
    lines.push(`Name: ${els.pName.textContent}`);
    lines.push(`Retail: ${els.pRetail.textContent}`);
    lines.push(`Down: ${els.pDown.textContent}`);
    lines.push(`Balance: ${els.pBal.textContent}`);
    lines.push(`Monthly: ${els.pMonthly.textContent}`);
    lines.push(`Tax: ${els.pTax.textContent}`);
    lines.push(`Due Today: ${els.pDue.textContent}`);
    lines.push(`Pay in Full: ${els.pFull.textContent}`);
  }

  if (!els.watchDetails.hidden) {
    lines.push("", "Watch");
    lines.push(`Name: ${els.wName.textContent}`);
    lines.push(`Retail: ${els.wRetail.textContent}`);
    lines.push(`Down: ${els.wDown.textContent}`);
    lines.push(`Balance: ${els.wBal.textContent}`);
    lines.push(`Monthly: ${els.wMonthly.textContent}`);
    lines.push(`Tax: ${els.wTax.textContent}`);
    lines.push(`Due Today: ${els.wDue.textContent}`);
    lines.push(`Pay in Full: ${els.wFull.textContent}`);
    if (els.watchNote.textContent) {
      lines.push(`Note: ${els.watchNote.textContent}`);
    }
  }

  if (!els.comboDetails.hidden) {
    lines.push("", "Combined Devices");
    lines.push(`Devices Added: ${els.cCount.textContent}`);
    lines.push(`Total Device Retail: ${els.cRetail.textContent}`);
    lines.push(`Total Monthly: ${els.cMonthly.textContent}`);
    lines.push(`Total Device Tax: ${els.cTax.textContent}`);
    lines.push(`Devices Due Today: ${els.cDue.textContent}`);
    lines.push(`Devices Pay in Full: ${els.cFull.textContent}`);
    lines.push(`Selected Due Total: ${els.cSelectedDue.textContent}`);
    lines.push(`Selected Full Total: ${els.cSelectedFull.textContent}`);
  }

  copyText(lines.join("\n"))
    .then(() => {
      els.copyBtn.textContent = "Copied!";
      setTimeout(() => {
        els.copyBtn.textContent = "Copy Summary";
      }, 1000);
    })
    .catch(() => {
      showError("Copy failed. Try again or long-press to copy on your device.");
    });
}

function bindMoneyInput(input) {
  input.addEventListener("input", () => {
    sanitizeMoneyInput(input);
    queueRecalc();
  });

  input.addEventListener("blur", queueRecalc);
}

function bindEvents() {
  [els.accEligible, els.accNoDisc, els.phoneRetail, els.watchRetail].forEach(bindMoneyInput);

  [els.phoneName, els.watchName].forEach((input) => {
    input.addEventListener("input", queueRecalc);
    input.addEventListener("blur", queueRecalc);
  });

  els.taxRate.addEventListener("input", queueRecalc);
  els.taxRate.addEventListener("blur", queueRecalc);

  [els.aarpUsaa, els.addAccToDue, els.addAccToFull].forEach((el) => {
    el.addEventListener("change", queueRecalc);
  });

  els.enablePhone.addEventListener("change", () => {
    setDeviceVisibility();
    queueRecalc();
  });

  els.enableWatch.addEventListener("change", () => {
    setDeviceVisibility();
    queueRecalc();
  });

  els.calcBtn.addEventListener("click", () => calculate(true));
  els.copyBtn.addEventListener("click", copySummary);
  els.resetBtn.addEventListener("click", resetAll);

  els.jumpSummaryBtn.addEventListener("click", () => {
    els.summary.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  els.themeBtn.addEventListener("click", () => {
    applyTheme(!document.body.classList.contains("dark"));
    savePrefs();
  });
}

function init() {
  bindEvents();
  loadPrefs();
  setDeviceVisibility();
  updateModeChip();
  clearError();
  resetSummaryUI();
}

init();
