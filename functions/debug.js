const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

exports.debugDb = onRequest({ invoker: "public" }, async (req, res) => {
    try {
        const snapshot = await db.collection("artifacts").doc("fds-operations-hub").collection("public").doc("data").collection("calls").orderBy("createdAt", "desc").limit(20).get();
        const calls = [];
        snapshot.forEach(doc => calls.push({ id: doc.id, ...doc.data() }));
        
        const rootSnapshot = await db.collection("calls").limit(20).get();
        const rootCalls = [];
        rootSnapshot.forEach(doc => rootCalls.push({ id: doc.id, ...doc.data() }));

        res.json({
            success: true,
            path: "artifacts/fds-operations-hub/public/data/calls",
            calls: calls,
            rootCalls: rootCalls
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
