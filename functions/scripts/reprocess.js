// reprocess.js
// Run this script locally with: node reprocess.js
//
// NOTE: reprocessFailed is no longer invoker:"public" (see functions/index.js).
// This plain fetch() will now get a 403. Add an Authorization header with a
// GCP identity token before running, e.g.:
//   gcloud auth print-identity-token
// and pass it as `Authorization: Bearer <token>` on the fetch below.

async function reprocessAll() {
    console.log("Starting batch reprocessing of failed calls...");
    let keepGoing = true;
    let totalProcessed = 0;

    while (keepGoing) {
        try {
            console.log("Fetching next batch of 10 calls...");
            const res = await fetch("https://us-central1-fds-operations-hub.cloudfunctions.net/reprocessFailed?limit=10");
            const data = await res.json();

            if (data.message === "No failed calls found.") {
                console.log("All caught up! No more failed calls.");
                keepGoing = false;
            } else if (data.success) {
                totalProcessed += data.reprocessed;
                console.log(`Successfully reprocessed ${data.reprocessed} calls in this batch. Total: ${totalProcessed}`);
            } else {
                console.error("Error from server:", data);
                keepGoing = false;
            }
        } catch (err) {
            console.error("Failed to connect to the reprocess endpoint:", err.message);
            keepGoing = false;
        }
    }
}

reprocessAll();
