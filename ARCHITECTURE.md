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
    *   **OpenAI (GPT-4o):** Analyzes the text transcript to generate a summary, guess the priority, and assign the call to a specific department queue.

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
4. **Analysis:** The raw transcript is sent to GPT-4o with a specific prompt. The AI is asked to:
    * Write a 2-sentence summary.
    * Determine the priority (NORMAL, TODAY, URGENT, ESCALATED).
    * Assign it to a specific queue (e.g., Billing, Hygiene).
    * Identify the staff member on the phone.
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

## 4. Understanding the Source Code

If you want to read the code, here is the best order to look at the files:

1.  **`src/App.jsx`**: The starting point. It handles login and routing.
2.  **`src/pages/LiveDispatch.jsx`**: The main layout. It decides which calls go where.
3.  **`src/components/CallCard.jsx`**: The visual design of a single call ticket.
4.  **`src/hooks/useCalls.js`**: The magic connection to the real-time database.
5.  **`functions/index.js`**: The backend server that talks to Mango Voice and OpenAI.
