// Payroll business-logic formulas: time parsing, loaded labor cost, production targets.

// Employer payroll tax multiplier — 17% overhead load for employer-paid
// FICA, FUTA, SUTA, workers' comp, and benefits.
export const PAYROLL_TAX_RATE = 1.17;
export const STAFF_OVERHEAD_TARGET = 0.25; // 25% target staff labor overhead
export const DR_OVERHEAD_TARGET = 0.28;    // 28% target doctor labor overhead

/**
 * Calculates total decimal hours between a start time and end time.
 * Supports overnight shifts and standard AM/PM formats.
 */
export const calculateHoursFromTimes = (start, end) => {
  if (!start || !end) return 0;

  const parseTime = (timeStr) => {
    const cleanStr = timeStr.trim();
    const modifierMatch = cleanStr.match(/[ap]m/i);
    const modifier = modifierMatch ? modifierMatch[0].toUpperCase() : null;

    let timePart = cleanStr.replace(/[ap]m/i, '').trim();
    let [hours, minutes] = timePart.split(':').map(Number);

    if (isNaN(hours)) return new Date(0, 0, 0, 0, 0);
    if (isNaN(minutes)) minutes = 0;

    if (hours === 12) hours = 0;
    if (modifier === 'PM') hours += 12;

    return new Date(0, 0, 0, hours, minutes);
  };

  const startDate = parseTime(start);
  const endDate = parseTime(end);

  if (endDate < startDate) {
    endDate.setDate(endDate.getDate() + 1);
  }

  const diffMs = endDate.getTime() - startDate.getTime();
  const diffHrs = diffMs / 1000 / 60 / 60;

  return Math.max(0, parseFloat(diffHrs.toFixed(2)));
};

/**
 * Standardizes shorthand user inputs into "HH:MM AM/PM" strings.
 * "9" -> "9:00 AM", "5p" -> "5:00 PM", "830" -> "8:30 AM", "12" -> "12:00 PM"
 */
export const formatSmartTime = (val, isEnd = false) => {
  if (!val) return '';
  let clean = val.toLowerCase().replace(/[^0-9ap:]/g, '');
  if (!clean) return '';

  let isPM = clean.includes('p');
  let isAM = clean.includes('a');
  let numericPart = clean.replace(/[ap]/g, '');

  if (!numericPart.includes(':')) {
    if (numericPart.length === 3) {
      numericPart = numericPart[0] + ':' + numericPart.slice(1);
    } else if (numericPart.length === 4) {
      numericPart = numericPart.slice(0, 2) + ':' + numericPart.slice(2);
    } else if (numericPart.length <= 2) {
      numericPart = numericPart + ':00';
    }
  }

  let [hStr, mStr] = numericPart.split(':');
  let h = parseInt(hStr, 10);
  let m = mStr ? parseInt(mStr, 10) : 0;

  if (isNaN(h)) return val;

  if (!isPM && !isAM) {
    if (isEnd && h >= 1 && h <= 11) {
      isPM = true;
    } else if (!isEnd && h >= 1 && h <= 6) {
      isPM = true;
    } else if (h === 12) {
      isPM = true;
    }
    // else: falls through to AM (the default in `suffix` below)
  }

  const suffix = isPM ? 'PM' : 'AM';
  const mDisplay = m.toString().padStart(2, '0');

  return `${h}:${mDisplay} ${suffix}`;
};

export const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};

/** Fully loaded cost of employee shifts, including employer tax/benefits load. */
export const calculateStaffCost = (hours, rate) => {
  return hours * rate * PAYROLL_TAX_RATE;
};

/** Production/revenue needed to balance a labor cost at a target overhead percentage. */
export const calculateProductionNeeded = (cost, targetPercentage) => {
  if (targetPercentage === 0) return 0;
  return cost / targetPercentage;
};

/** EBITDA = Collections revenue - payroll expenses. */
export const calculateProjectedEBITDA = (collections, expenses) => {
  return collections - expenses;
};
