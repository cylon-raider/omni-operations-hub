// Shared outbound-call detection logic, used by both the Live Dispatch
// queue (src/pages/LiveDispatch.jsx) and the Outbound Leaderboard
// (src/components/OutboundLeaderboardCard.jsx) so the two views can't drift
// out of sync about what counts as a valid outbound call.

// Misspellings/nicknames that should be folded into a canonical employee
// name before the location whitelist check. 'IGNORE' means "don't count
// this call at all" (e.g. a shared/ambiguous name).
// Note: 'lisa' is intentionally NOT aliased to 'ALESSIA' here — Lisa
// Vasquez is a distinct real employee (see GLENDALE_STAFF below).
export const NAME_ALIASES = {
  'devon': 'DEVIN',
  'alacia': 'ALICIA',
  'iliana': 'EYLIANNA',
  'aliana': 'EYLIANNA',
  'eliana': 'EYLIANNA',
  'ileana': 'EYLIANNA',
  'alicia': 'ALESSIA',
  'mara': 'MARAH',
  'mary ann': 'MARIANNE',
  'malia': 'MELIA',
  'kiana': 'KEANNA',
  'brandi': 'BRANDY',
  'uncle': 'ANKUR',
  'amkur': 'ANKUR',
  'akkur': 'ANKUR',
  'b': 'IGNORE',
  'bea': 'IGNORE',
  'tim': 'IGNORE',
};

// 'devin' removed — no longer works here, so she shouldn't be recognized as
// a valid employee for NEW calls to be classified outbound against. The
// 'devon' -> 'DEVIN' alias above stays: it's spelling normalization for
// existing historical records (merging a misheard "Devon" into "Devin"
// rather than fragmenting the two), unrelated to current employment.
const GLENDALE_STAFF = ['jen', 'lisa', 'jamie', 'addison', 'mariana', 'brandy', 'liz', 'alessia', 'marianne', 'aubrey', 'marah', 'pam', 'eylianna', 'dan'];
const LITCHFIELD_STAFF = ['jen', 'melia', 'cynthia', 'lupita', 'rachel', 'aron'];

/**
 * Resolves a raw employeeName to its canonical (lowercase) form via
 * NAME_ALIASES. Returns null for blank names or names mapped to 'IGNORE'.
 */
export function resolveEmployeeAlias(rawName) {
  const name = (rawName || '').toLowerCase().trim();
  if (!name) return null;
  const alias = NAME_ALIASES[name];
  if (alias === 'IGNORE') return null;
  return (alias || name).toLowerCase();
}

/**
 * Reads Mango's own direction signal for a call — the ground-truth
 * telephony metadata, either the parsed `direction` field or (as a
 * fallback, if that field is missing) the same value embedded in the raw
 * webhook JSON. Returns 'outbound' | 'inbound' | null.
 */
function getMangoDirection(call) {
  if (call.direction === 'outbound' || call.direction === 'inbound') return call.direction;
  if (call.rawEvent && typeof call.rawEvent === 'string') {
    const match = call.rawEvent.match(/"direction"\s*:\s*"([^"]+)"/i);
    if (match && match[1]) {
      const dir = match[1].toLowerCase();
      if (dir === 'outbound' || dir === 'inbound') return dir;
    }
  }
  return null;
}

/**
 * Determines whether a call record should be treated as outbound (staff
 * calling a patient) vs inbound.
 *
 * When Mango itself reports a direction, that's trusted unconditionally —
 * it's ground truth, independent of whether we can also identify which
 * employee handled the call. Short outbound calls that skip AI analysis
 * (see mangoWebhook's skipTranscription) never get an employeeName, but
 * they're still definitely outbound.
 *
 * Only the weaker fallback signals (GPT's own `isOutbound` guess, or a
 * name-based heuristic), used when Mango gives no direction at all, need
 * employee-whitelist corroboration to avoid false positives.
 */
export function isCallOutbound(call, officeLocation = 'glendale') {
  const mangoDirection = getMangoDirection(call);
  if (mangoDirection === 'outbound') return true;
  if (mangoDirection === 'inbound') return false;

  let outbound = false;
  if (call.isOutbound === true) {
    outbound = true;
  } else {
    const n = (call.fromName || call.name || '').toLowerCase();
    if ((n.includes('family dental') || n.includes('chewy dental')) && !n.includes('provider')) {
      outbound = true;
    }
  }

  if (!outbound) return false;

  const empName = resolveEmployeeAlias(call.employeeName);
  if (!empName) return false;

  const validNames = officeLocation === 'litchfield' ? LITCHFIELD_STAFF : GLENDALE_STAFF;
  return validNames.includes(empName);
}
