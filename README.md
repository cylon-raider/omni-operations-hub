# FDS Operations Hub

FDS Operations Hub is a real-time dispatch and callback management system custom-built for Family Dental Station (FDS). It intelligently processes incoming patient calls using AI and routes them to the appropriate department queues, ensuring no patient callbacks slip through the cracks.

## How It Works

The system operates across three seamlessly integrated layers:

1. **Mango Voice & Firebase Backend:**
   - When a call finishes, Mango Voice sends a webhook containing call metadata and the call recording URL to a **Firebase Cloud Function**.
   - The Cloud Function instantly creates a "Processing" record in Firestore, which immediately appears on the Web App dashboard.
   - It then downloads the audio and uses **OpenAI Whisper** to transcribe the call, followed by **OpenAI GPT-4o** to generate a concise summary, determine caller sentiment, assign a priority level (e.g., URGENT, TODAY, NORMAL), and route the call to a specific department (e.g., Treatment Coordinator, Pod 1, Billing).

2. **Real-time React Dashboard:**
   - The React-based Web App listens to Firestore and updates instantly when the AI finishes processing. 
   - Staff can view the Active Queue, filter by their specific department, read the AI summary and suggested action, and click **Complete** to move the call into the Resolved queue.
   - Staff can also manually enter "Quick Callbacks" into the system without leaving the dashboard.

3. **Google Sheets Sync:**
   - Once AI processing is complete, the Cloud Function forwards the enriched payload to a **Google Apps Script** webhook.
   - The Apps Script logs the raw data into a `MANGO CALLS` sheet for auditing and populates a `DISPATCH BOARD` sheet, mirroring the Web App for staff members who prefer working out of spreadsheets.

## Application Architecture

- **Frontend:** React (Vite), Tailwind CSS, Lucide Icons. Hosted on Firebase Hosting.
- **Backend:** Firebase Cloud Functions (Node.js).
- **Database:** Firebase Firestore (Real-time NoSQL).
- **AI Integrations:** OpenAI API (Whisper & GPT-4o).
- **External Integrations:** Mango Voice (VoIP Webhooks), Google Workspace (Apps Script).

## Installation & Local Development

### 1. Prerequisites
- Node.js (v18 or higher)
- Firebase CLI (`npm install -g firebase-tools`)
- A Firebase project with Firestore, Functions, and Hosting enabled.

### 2. Frontend Setup
```bash
# Install dependencies
npm install

# Start the local development server
npm run dev
```

### 3. Backend Setup
```bash
cd functions
npm install

# Create a .env file in the functions directory with your keys:
# OPENAI_API_KEY=your_openai_key
# MANGO_TOKEN=your_mango_api_token
# GOOGLE_SHEET_WEBHOOK_URL=your_apps_script_url
```

### 4. Deployment
To build the React application and deploy both the frontend and the cloud functions to Firebase:
```bash
npm run build
firebase deploy
```

## Key Features

1. **Distinct Routing Queues:** The dashboard automatically separates calls into three main queues: **Active Inbound** (patient callbacks), **Active Outbound** (staff callbacks), and **Resolved Today** (completed tasks), keeping the workflow organized.
2. **AI-Automated Resolution:** The backend AI analyzes outbound calls made by staff. If it detects a staff member successfully resolved a patient's issue, it automatically finds the corresponding inbound callback request in the queue and marks it as resolved, requiring zero manual clicks!
3. **Outbound Leaderboard:** The AI automatically extracts the names of employees making outbound calls and tallies them on a live leaderboard. Features timeframe filtering (Day, Week, Month) to easily track team callback performance and drive incentive programs.
4. **Role-Based Access Control (RBAC):** Firebase Security Rules ensure that only authorized administrators can permanently delete historical call data, protecting the system from accidental data loss while still allowing standard staff to resolve and edit active calls.
5. **Intelligent Routing & Prioritization Rules:** The AI backend is configured with specific routing logic to streamline workflows. For example, any mention of a "payment plan" or "financing" is automatically routed to the Treatment Coordinator, while mentions of "prescriptions" or "medications" are automatically flagged as URGENT.
## Using the Dashboard

1. **Filtering Queues:** Click the department buttons (e.g., Treatment, Pod 1, Clinical) at the top of the dashboard to filter the active queue to your specific responsibilities.
2. **Reviewing Calls:** Each call card displays the patient's name, phone number, wait time, priority, and the AI-generated summary of what happened during the call.
3. **Resolving Calls:** After returning a patient's call, click the green **Complete** button. The call will be removed from the Active Queue and sent to the collapsible "Resolved Today" section at the bottom of the page.
4. **Manual Entry:** Use the Quick Callback Entry form docked below the filters to manually add tasks to the board.
