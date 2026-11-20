# FDS Operations Hub - Architecture & Execution Flow

Welcome to the FDS Operations Hub! This document breaks down exactly how this application works from a high-level perspective all the way down to a step-by-step execution flow.

## 1. The Technology Stack

This application is built using a modern, serverless "JAMstack" architecture. This means there are no dedicated servers to maintain. Everything scales automatically.

*   **Frontend (The User Interface):** 
    *   **React:** The core library used to build the user interface.
    *   **Vite:** The build tool that bundles the code and serves it lightning fast.
    *   **Tailwind CSS:** A utility-first CSS framework used for all the styling (colors, layout, responsiveness).
*   **Backend (The Database & Logic):**
    *   **Firebase Hosting:** Hosts the static frontend files (HTML/CSS/JS) securely on Google's global CDN.
    *   **Firebase Authentication:** Handles user logins, passwords, and security securely.
    *   **Cloud Firestore:** A real-time, NoSQL database. When data changes here, it instantly pushes updates to any open browser window.
    *   **Firebase Cloud Functions (Node.js):** Serverless backend code that runs only when triggered. This is our "Webhook Receiver."
*   **AI Integration:**
    *   **OpenAI (Whisper):** Converts raw audio recordings of phone calls into text (Speech-to-Text).
    *   **OpenAI (GPT-4o-mini):** Analyzes the text transcript to generate a summary, guess the priority, assign the call to a specific department queue, and score caller sentiment from -1.0 to +1.0.

## 2. High-Level Architecture

The system acts as a bridge between the physical phone system and the office staff.

1.  **The Trigger:** A phone call occurs on the Mango Voice VoIP system.
2.  **The Handshake:** Mango Voice sends a digital message (a "Webhook") containing the call details and a link to the audio recording to our **Cloud Function**.
3.  **The Processing:** Our Cloud Function receives this payload, downloads the audio, sends it to OpenAI for transcription and analysis, and then saves the final, intelligent result into **Cloud Firestore**.
4.  **The Display:** The React Frontend is constantly "listening" to Cloud Firestore. The moment the database updates, the new call pops up on the screen in real-time, no refresh required.

## 3. Execution Flow: Step-by-Step

Let's walk through exactly what happens during a typical inbound call.

### Phase 1: The Phone Call
1. A patient calls the front desk. The call is completed and recorded by Mango Voice.
2. Mango Voice fires a `POST` request to our Cloud Function URL (`functions/index.js -> mangoWebhook`).
3. The payload contains data like the caller's phone number, the duration, and an `audio_url`.

### Phase 2: Cloud Function Processing (`functions/index.js`)
1. **Immediate Write:** The Cloud Function instantly writes a "stub" record to Firestore. This makes the call show up on the frontend immediately with a status of "Processing", so staff know a call just ended.
2. **Audio Download:** The function securely downloads the MP3/WAV file from the Mango `audio_url`.
3. **Transcription:** The audio file is sent to the OpenAI Whisper API. Whisper returns a raw text transcript of the conversation.
4. **Analysis:** The raw transcript is sent to GPT-4o-mini with a specific prompt. The AI is asked to:
    * Write a 2-sentence summary.
    * Determine the priority (NORMAL, TODAY, URGENT, ESCALATED).
    * Assign it to a specific queue (e.g., Billing, Hygiene).
    * Identify the staff member on the phone.
    * Score caller sentiment as a number from -1.0 (very negative) to +1.0 (very positive), alongside a short text label (e.g. "Frustrated", "Happy").
5. **Final Database Update:** The Cloud Function updates the Firestore document with the AI's analysis.

### Phase 3: The Frontend React App (`src/App.jsx` & `src/hooks/useCalls.js`)
1. The user logs in securely using Firebase Auth.
2. The `useCalls.js` hook establishes an active WebSocket connection (`onSnapshot`) to the Firestore database.
3. When the Cloud Function updates the database in Phase 2, Firestore pushes that change down the WebSocket.
4. React detects that the `calls` array has changed.
5. `LiveDispatch.jsx` re-renders, sorting the new calls by priority and splitting them into "Active Inbound", "Active Outbound", or "Resolved".
6. The `CallCard.jsx` component renders the specific details (caller ID, AI summary, queue assignment).

### Phase 4: Staff Interaction
1. A staff member sees the new call in the "Billing" queue.
2. They click the "Mark In Progress" button on the `CallCard.jsx`.
3. The frontend calls the `updateCall` function (in `useCalls.js`), which writes the new status to Firestore.
4. Firestore pushes that update to *all* other logged-in computers instantly, preventing two people from working on the same call.
5. Once finished, the staff member clicks "Resolve". The call moves to the "Resolved Calls" section for the remainder of the day.

## 4. Caller Sentiment Scoring

1. **`functions/index.js`** asks GPT-4o-mini for a `sentiment_score` (-1.0 to +1.0) on every transcribed call, stored as `sentimentScore` alongside the short text `sentiment` label it already produced. This is one extra field on the same existing analysis request, not a separate API call.
2. **`src/utils/sentiment.js`** is the single source of truth for turning a call into a score, used by both the per-call gauge and the aggregated trends card so they can't disagree. It prefers `sentimentScore` when present; for calls processed before that field existed, it falls back to mapping the older `sentiment` text label (a small, fixed set of values GPT has always produced — "Frustrated", "Neutral", "Happy", etc.) to an equivalent score, so every historical call still gets a gauge with no backfill or re-processing needed.
3. **`src/components/SentimentGauge.jsx`** renders the score as a semicircle gauge with the needle positioned continuously along the arc (not snapped to fixed negative/neutral/positive slots), used both small (on `CallCard.jsx`) and large (on the trends card).
4. **`src/components/SentimentTrendsCard.jsx`** aggregates scores across Day/Week/Month/All-Time (mirroring `OutboundLeaderboardCard.jsx`'s own timeframe pattern), and includes a negative/neutral/positive filter dropdown that opens a modal listing every matching transcript for the selected timeframe.

## 5. The Financials & Payroll Module

This module lives at the same `/financials` route and shares the same Firebase Auth/Firestore project as call dispatch — it does not have its own login.

1. **`src/pages/Financials.jsx`** is the entry point mounted at `/financials`. It doesn't have its own routes for Overview/Schedule/Team — those are just internal tab state, rendered via `src/components/financials/{FinancialsOverview,ScheduleGrid,TeamDirectory}.jsx`.
2. **`src/hooks/usePayrollRole.js`** reads (and bootstraps, on first visit) a `payrollRole` field on the same `users/{uid}` doc call-dispatch already uses. It's a separate field from that doc's job-title `role` field.
3. **Pay rates are deliberately split out** of the staff directory (`payroll_staff`) into a separate `payroll_staffRates` collection, so `firestore.rules` can restrict reads per-person (a payroll admin can read every rate; a staff member can only read the one rate doc linked, via an admin-set email, to their own login) instead of only hiding it in the UI.
4. **Office location** is shared with call dispatch: `Financials.jsx` receives the same `officeLocation`/`setOfficeLocation` state `App.jsx` already holds for `LiveDispatch.jsx`, rather than keeping its own copy. Each `payroll_staff` doc carries a `location` field (`glendale`/`litchfield`, defaulting to `glendale` if absent) that `TeamDirectory.jsx`, `ScheduleGrid.jsx`, and `FinancialsOverview.jsx` all filter by. `payroll_dailyLogs/{date}.collections` is a map keyed by office (`{ glendale: n, litchfield: n }`, not a single practice-wide number), so each office's EBITDA is computed against its own collections.
5. **`functions/scripts/`** holds one-off Node scripts (data migration, diagnostics) used to move real data over from a previously separate `fds-payroll` Firebase project — not deployed as Cloud Functions, run locally with `node functions/scripts/<name>.js`.

## 6. Dentrix Ascend Patient Lookup

1. **`functions/dentrix.js`** looks up the *other party's* phone number (the caller on inbound calls, the number dialed on outbound) in that office's Dentrix Ascend, and stores a minimal `dentrix` field on the call doc: match status (`matched` / `multiple` / `none` / `skipped` / `error`), and for up to 3 patients their name, chart number, state, and next non-cancelled appointment. No birth dates, addresses, insurance, or SSNs are stored.
2. Dentrix is reached through **Zatanna** (`api.zatanna.ai`), which keeps a logged-in Dentrix Ascend session per office (session ids for Glendale/Litchfield are in `dentrix.js`). Only read-only operations are called (`searchContacts`, `listFutureAppointments`). The API key is the `ZATANNA_API_KEY` secret in Secret Manager, never in the repo.
3. **`mangoWebhook`** runs the lookup alongside the AI transcription step for every non-internal call, so it never delays the call appearing. **`lookupDentrix`** (signed-in users only) re-runs it for one call; `CallCard.jsx` shows a "Find in Dentrix" button for calls with no lookup yet or a failed one.
4. Note: Zatanna's Dentrix integration has **no call-recording or transcript operations** — Dentrix never held the audio. Recordings come from Zatanna's separate Mango Voice integration (Section 7).

## 7. Mango Recordings via Zatanna

Since 2026-10-13 Mango's webhook stopped including `recording_url`. Zatanna also keeps a logged-in **Mango Voice** session per office, and its `getCall` returns a signed recording URL (valid ~1 hour).

1. **`syncMangoRecordings`** (scheduled, every 5 minutes) runs **`functions/mango.js`**: list each office's recent Mango calls, skip ineligible ones (missed, internal, under 25s), **match** each to the call doc the webhook already created (same office + outside party's phone number + `createdAt` within [start − 10m, end + 40m]), fetch a fresh recording URL, and run the normal `processAudioAndAnalyze` pipeline.
2. Recovered transcripts use `keepStatus` (a call staff already marked In Progress/Resolved keeps that status) and set `recordingSource: "zatanna-mango"` + `mangoCallId` on the call doc.
3. Progress lives in admin-only Firestore collections: `mango_sync_calls/{office}_{mangoCallId}` (done / has_transcript / ineligible / unmatched / no_recording / error + attempts), and `mango_sync_state` (backfill cursors + a run lease so overlapping runs never double-process).
4. **Backfill** of the outage backlog is controlled by `MANGO_BACKFILL` in `functions/.env`: `off` (default), `count` (tallies eligible calls + minutes into the logs, no OpenAI spend), or `run` (transcribes ~30 calls per run, oldest first, with outbound auto-resolve disabled). `MANGO_BACKFILL_SINCE` sets the start (default 2026-10-13).

5. **Missed calls & voicemails.** The same sync classifies each Mango call (`callKind`): a **voicemail** (`voicemailId` set) is transcribed like any call and tagged `callKind: "voicemail"`; a **missed** call with no message is labeled a callback (`callKind: "missed"`, reason "Missed call", priority bumped to TODAY on live calls) or `"hangup"` if under 5 seconds. `CallCard.jsx` shows red/amber badges for these.
6. **Returned calls.** In the ongoing pass, an outbound call that connected for 20s+ to a number resolves that office's open missed/voicemail calls from the same number within the last 7 days (`resolvedBy: "Returned call (<phone station>)"`). The backfill never does this.

## 8. Appointment Confirmations Board

1. **`syncConfirmations`** (scheduled every 15 min, 6am–6pm Phoenix) runs **`functions/confirmations.js`**: read today + the next 3 days of appointments from Dentrix (`listAppointments`, enhanced mode, read-only) and keep the **unconfirmed** ones in `artifacts/{appId}/public/data/confirmations/{office}_{appointmentId}` — patient name, time, provider, operatory, description, phone (one `getContact` per new row), reminder texts sent. No notes, procedures or other clinical detail are stored.
2. Each sync flips rows to `confirmed` when Dentrix shows them confirmed, and flags `gone` for appointments that were cancelled, broken or moved; rows older than 14 days are deleted. Appointments already confirmed when first seen are never stored.
3. **`src/pages/Confirmations.jsx`** (`/confirmations`, via `src/hooks/useConfirmations.js`) shows the list per day. Staff confirm **in Dentrix** — the hub never writes to Dentrix — and can only record `outreach` (left message / no answer / will call back / wrong number) on a row; `firestore.rules` enforces that. **`refreshConfirmations`** backs the "Refresh now" button (signed-in users, throttled to once a minute per office).

## 9. Understanding the Source Code

If you want to read the code, here is the best order to look at the files:

1.  **`src/App.jsx`**: The starting point. It handles login and routing.
2.  **`src/pages/LiveDispatch.jsx`**: The main layout. It decides which calls go where.
3.  **`src/components/CallCard.jsx`**: The visual design of a single call ticket.
4.  **`src/hooks/useCalls.js`**: The magic connection to the real-time database.
5.  **`functions/index.js`**: The backend server that talks to Mango Voice and OpenAI.
6.  **`src/utils/sentiment.js`**: Turns a call into a sentiment score (see Section 4 above).
7.  **`src/pages/Financials.jsx`**: The Financials & Payroll module (see Section 5 above).
