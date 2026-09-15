// User-facing changelog shown in the sidebar's "What's New" panel. Newest
// entry first. Add a new { date, items } entry here whenever a change is
// worth surfacing to staff — the panel's pulsing dot re-activates
// automatically for anyone who hasn't seen the newest date yet.
export const CHANGELOG = [
  {
    date: '2026-09-15',
    items: [
      'Fixed a bug where some outbound calls were being misfiled as inbound on the Live Dispatch board.',
      'Added an AI sentiment gauge to each call with a transcript, plus a Caller Sentiment card (Day/Week/Month/All-Time) with negative/neutral/positive filtering and transcript viewing.',
      'Added a Glendale/Litchfield toggle to Financials & Payroll, matching Live Dispatch.',
    ],
  },
];

export const LATEST_CHANGE_DATE = CHANGELOG[0]?.date || null;
