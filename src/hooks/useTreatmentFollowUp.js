// -----------------------------------------------------------------------------
// useTreatmentFollowUp.js
// -----------------------------------------------------------------------------
// Live list of patients with planned treatment that has no appointment, for one
// office. Rows are maintained by the syncTreatmentFollowUp Cloud Function
// (functions/treatment.js); the app only records staff outreach on them.
// -----------------------------------------------------------------------------
import { useState, useEffect, useCallback } from 'react';
import { collection, doc, onSnapshot, query, updateDoc, where, serverTimestamp } from 'firebase/firestore';
import { db, APP_ID } from '../config/firebase';

const PATH = `artifacts/${APP_ID}/public/data/unscheduled_treatment`;

export function useTreatmentFollowUp(user, office) {
  const [rows, setRows] = useState([]);
  const [loadedFor, setLoadedFor] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    return onSnapshot(
      query(collection(db, PATH), where('office', '==', office)),
      (snap) => {
        const items = [];
        snap.forEach((d) => {
          const data = d.data();
          if (!data.cleared && (data.count || 0) > 0) items.push({ id: d.id, ...data });
        });
        items.sort((a, b) => (b.totalFee || 0) - (a.totalFee || 0));
        setRows(items);
        setError(null);
        setLoadedFor(office);
      },
      (err) => {
        console.error('Treatment follow-up listener error:', err);
        setError('Could not load the treatment list.');
        setLoadedFor(office);
      },
    );
  }, [user, office]);

  const setOutreach = useCallback(async (rowId, status) => {
    await updateDoc(doc(db, PATH, rowId), {
      outreach: { status: status || null, note: '', by: user?.displayName || user?.email || 'Staff', at: serverTimestamp() },
    });
  }, [user]);

  const loading = !!user && loadedFor !== office;
  return { rows: user && !loading ? rows : [], loading, error, setOutreach };
}
