const fetch = require('node-fetch');

const WEBHOOK_URL = "https://mangowebhook-tckilgaywa-uc.a.run.app?location=litchfield";

const testCalls = [
  { summary: "Patient wants to schedule a cleaning.", assignment: "Front Desk Supervisor", priority: "NORMAL", status: "Waiting", location: "litchfield", direction: "inbound" },
  { summary: "Patient needs to cancel their appointment for tomorrow.", assignment: "Front Desk Supervisor", priority: "NORMAL", status: "Waiting", location: "litchfield", direction: "inbound" },
  { summary: "Caller has a question about a bill they received.", assignment: "Billing", priority: "NORMAL", status: "Waiting", location: "litchfield", direction: "inbound" },
  { summary: "Patient is in severe pain and needs an emergency extraction.", assignment: "Clinical / Labs", priority: "URGENT", status: "Waiting", location: "litchfield", direction: "inbound" },
  { summary: "Patient calling to ask about teeth whitening pricing.", assignment: "Treatment Coordinator", priority: "NORMAL", status: "Waiting", location: "litchfield", direction: "inbound" },
  { summary: "Pharmacy calling for a prescription refill authorization.", assignment: "Clinical / Labs", priority: "URGENT", status: "Waiting", location: "litchfield", direction: "inbound" },
  { summary: "Patient wants to know if you accept Cigna insurance.", assignment: "Front Desk Supervisor", priority: "NORMAL", status: "Waiting", location: "litchfield", direction: "inbound" },
  { summary: "Patient calling to discuss a payment plan for their implants.", assignment: "Treatment Coordinator", priority: "NORMAL", status: "Waiting", location: "litchfield", direction: "inbound" },
  { summary: "Caller is a vendor offering new dental supplies.", assignment: "Front Desk Supervisor", priority: "NORMAL", status: "Waiting", location: "litchfield", direction: "inbound" },
  { summary: "Patient's temporary crown fell off and needs to be recemented.", assignment: "Clinical / Labs", priority: "TODAY", status: "Waiting", location: "litchfield", direction: "inbound" },
];

async function sendTests() {
  for (let i = 0; i < testCalls.length; i++) {
    const callId = `test-litchfield-${Date.now()}-${i}`;
    const payload = {
      call_main_uuid: callId,
      type: "call_summary",
      direction: testCalls[i].direction,
      source_number: "+1555000123" + i,
      source_name: "Test Patient " + i,
      destination_number: "+15559998888",
      summary: testCalls[i].summary,
      assignment: testCalls[i].assignment,
      priority: testCalls[i].priority,
      status: testCalls[i].status
    };

    console.log(`Sending test call ${i + 1}...`);
    try {
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      console.log(`Result: ${res.status} ${await res.text()}`);
    } catch (e) {
      console.error(e);
    }
  }
}

sendTests();
