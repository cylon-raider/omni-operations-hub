// User-facing changelog shown in the sidebar's "What's New" panel. Newest
// entry first. Add a new { date, items } entry here whenever a change is
// worth surfacing to staff — the panel's pulsing dot re-activates
// automatically for anyone who hasn't seen the newest date yet.
export const CHANGELOG = [
  {
    date: '2026-10-17',
    items: [
      'Heads up: on Oct 13 our phone system (Dentrix Ascend Phones / Mango) stopped sending call recordings to the hub, so newer calls come in without an AI transcript, summary, or priority. We\'re working with the vendor on a permanent fix.',
      'New "Add Recording" button: on any call that\'s missing a transcript, you\'ll now see a purple "Add Recording" button in the call\'s actions — use it to get the AI summary, priority, sentiment, and transcript back for that call.',
      'How to use it: in Dentrix Ascend Phones, open the call, click the "⋮" menu, and choose "Download audio." Then back here, click "Add Recording" on that same call and pick the file you just downloaded.',
      'Give it about 20 seconds and the call fills in automatically, just like before. You only need to do this for the calls that matter — not every single one.',
    ],
  },
  {
    date: '2026-09-15',
    items: [
      'Fixed a bug where some outbound calls were being misfiled as inbound on the Live Dispatch board.',
      'Added an AI sentiment gauge to each call with a transcript, plus a Caller Sentiment card (Day/Week/Month/All-Time) with negative/neutral/positive filtering and transcript viewing.',
      'Added a Glendale/Litchfield toggle to Financials & Payroll, matching Live Dispatch.',
      'Made the "What\'s New" pulsing indicator (this one) actually visible — it was too subtle to notice at first.',
    ],
  },
];

export const LATEST_CHANGE_DATE = CHANGELOG[0]?.date || null;
