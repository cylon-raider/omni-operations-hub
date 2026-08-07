const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

async function migrate() {
    const callsRef = db.collection('artifacts').doc('fds-operations-hub').collection('public').doc('data').collection('calls');
    const snapshot = await callsRef.get();
    
    let count = 0;
    let batch = db.batch();
    
    for (const doc of snapshot.docs) {
        if (!doc.data().location) {
            batch.update(doc.ref, { location: 'glendale' });
            count++;
            
            if (count % 400 === 0) {
                await batch.commit();
                console.log(`Committed ${count} updates...`);
                batch = db.batch();
            }
        }
    }
    
    if (count % 400 !== 0) {
        await batch.commit();
    }
    
    console.log(`Migration complete. Updated ${count} calls.`);
}

migrate().catch(console.error);
