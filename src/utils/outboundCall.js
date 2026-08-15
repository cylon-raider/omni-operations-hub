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
  'alicia': 'ALESSIA',
  'mara': 'MARAH',
  'mary ann': 'MARIANNE',
  'b': 'IGNORE',
  'bea': 'IGNORE',
  'tim': 'IGNORE',
};

const GLENDALE_STAFF = ['jen', 'lisa', 'jamie', 'addison', 'mariana', 'brandy', 'devin', 'liz', 'alessia', 'marianne', 'aubrey', 'marah', 'pam', 'eylianna', 'dan'];
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
 * Determines whether a call record should be treated as outbound (staff
 * calling a patient) vs inbound. Also enforces a per-location employee
 * whitelist: an outbound-looking call from an unrecognized/blank employee
 * name is NOT counted, since we can't attribute it to a real staff member.
 */
export function isCallOutbound(call, officeLocation = 'glendale') {
  let outbound = false;

  if (call.direction === 'outbound') {
    outbound = true;
  } else if (call.direction === 'inbound') {
    return false;
  }

  if (!outbound && call.rawEvent && typeof call.rawEvent === 'string') {
    const match = call.rawEvent.match(/"direction"\s*:\s*"([^"]+)"/i);
    if (match && match[1]) {
      const dir = match[1].toLowerCase();
      if (dir === 'outbound') outbound = true;
      else if (dir === 'inbound') return false;
    }
  }

  if (!outbound) {
    if (call.isOutbound === true) {
      outbound = true;
    } else {
      const n = (call.fromName || call.name || '').toLowerCase();
      if ((n.includes('family dental') || n.includes('chewy dental')) && !n.includes('provider')) {
        outbound = true;
      }
    }
  }

  if (!outbound) return false;

  const empName = resolveEmployeeAlias(call.employeeName);
  if (!empName) return false;

  const validNames = officeLocation === 'litchfield' ? LITCHFIELD_STAFF : GLENDALE_STAFF;
  return validNames.includes(empName);
}
