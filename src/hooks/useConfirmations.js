// -----------------------------------------------------------------------------
// useConfirmations.js
// -----------------------------------------------------------------------------
// Live list of upcoming appointments that aren't confirmed in Dentrix, for one
// office. Rows are maintained by the syncConfirmations Cloud Function
// (functions/confirmations.js); the app only records staff outreach on them.
// -----------------------------------------------------------------------------
import { useState, useEffect, useCallback } from 'react';
import { collection, doc, onSnapshot, query, updateDoc, where, serverTimestamp } from 'firebase/firestore';
import { db, APP_ID } from '../config/firebase';

const CONFIRMATIONS_PATH = `artifacts/${APP_ID}/public/data/confirmations`;

export function useConfirmations(user, office) {
  const [rows, setRows] = useState([]);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  // Which office the current rows belong to; while it differs from `office`, we're loading.
  const [loadedFor, setLoadedFor] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    const q = query(collection(db, CONFIRMATIONS_PATH), where('office', '==', office));
    const unsubRows = onSnapshot(
      q,
      (snap) => {
        const items = [];
        snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
        items.sort((a, b) => (a.wallStartTime || '').localeCompare(b.wallStartTime || ''));
        setRows(items);
        setError(null);
        setLoadedFor(office);
      },
      (err) => {
        console.error('Confirmations listener error:', err);
        setError('Could not load confirmations.');
        setLoadedFor(office);
      },
    );
    const unsubState = onSnapshot(
      doc(db, 'confirmations_state', office),
      (snap) => setLastSyncedAt(snap.exists() ? snap.data().lastSyncedAt?.toDate?.() || null : null),
      () => setLastSyncedAt(null),
    );
    return () => { unsubRows(); unsubState(); };
  }, [user, office]);

  // Record (or clear, with status null) what staff did on a row.
  const setOutreach = useCallback(async (rowId, status, note) => {
    await updateDoc(doc(db, CONFIRMATIONS_PATH, rowId), {
      outreach: status
        ? { status, note: note || '', by: user?.displayName || user?.email || 'Staff', at: serverTimestamp() }
        : { status: null, note: '', by: user?.displayName || user?.email || 'Staff', at: serverTimestamp() },
    });
  }, [user]);

  const loading = !!user && loadedFor !== office;
  return { rows: user && !loading ? rows : [], lastSyncedAt, loading, error, setOutreach };
}
