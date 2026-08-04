const admin = require("firebase-admin");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

admin.initializeApp({
  projectId: "fds-operations-hub"
});

const db = admin.firestore();

async function run() {
  const snapshot = await db.collection("artifacts/fds-operations-hub/public/data/calls").get();
  console.log(`Found ${snapshot.size} calls in artifacts/fds-operations-hub/public/data/calls`);
  snapshot.forEach(doc => {
    console.log(doc.id, doc.data().createdAt, doc.data().status);
  });
  
  // Just in case, check root calls
  const rootSnapshot = await db.collection("calls").get();
  console.log(`Found ${rootSnapshot.size} calls in /calls`);
}

run().catch(console.error);
