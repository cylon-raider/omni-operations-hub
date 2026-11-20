// -----------------------------------------------------------------------------
// useHuddle.js
// -----------------------------------------------------------------------------
// Live view of one office's huddle document for one clinic date, built by the
// buildHuddle / refreshHuddle Cloud Functions (functions/huddle.js).
// -----------------------------------------------------------------------------
import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, APP_ID } from '../config/firebase';

export function useHuddle(user, office, date) {
  const [huddle, setHuddle] = useState(null);
  // Which "office_date" the current data belongs to; while it differs we're loading.
  const [loadedFor, setLoadedFor] = useState(null);
  const [error, setError] = useState(null);
  const key = `${office}_${date}`;

  useEffect(() => {
    if (!user || !date) return undefined;
    return onSnapshot(
      doc(db, `artifacts/${APP_ID}/public/data/huddles`, key),
      (snap) => {
        setHuddle(snap.exists() ? snap.data() : null);
        setError(null);
        setLoadedFor(key);
      },
      (err) => {
        console.error('Huddle listener error:', err);
        setError('Could not load the huddle.');
        setLoadedFor(key);
      },
    );
  }, [user, key, date]);

  const loading = !!user && loadedFor !== key;
  return { huddle: loading ? null : huddle, loading, error };
}
