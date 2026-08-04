import { useState, useEffect, useCallback } from 'react';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, query, orderBy,
} from 'firebase/firestore';
import { db, APP_ID } from '../config/firebase';

const CALLS_PATH = `artifacts/${APP_ID}/public/data/calls`;

export function useCalls(user) {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setCalls([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, CALLS_PATH)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items = [];
        snapshot.forEach((d) => items.push({ id: d.id, ...d.data() }));
        const priorityOrder = {
          'ESCALATED': 4,
          'URGENT': 3,
          'TODAY': 2,
          'NORMAL': 1
        };

        // Sort manually by priority (highest first), then by createdAt (newest first)
        items.sort((a, b) => {
          const pA = priorityOrder[a.priority?.toUpperCase()] || 0;
          const pB = priorityOrder[b.priority?.toUpperCase()] || 0;
          
          if (pA !== pB) {
            return pB - pA;
          }

          const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
          const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
          return tB - tA;
        });
        setCalls(items);
        setLoading(false);
      },
      (err) => {
        console.error('Firestore listener error:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  const addCall = useCallback(async (callData) => {
    if (!user) throw new Error('Not authenticated');
    return addDoc(collection(db, CALLS_PATH), {
      ...callData,
      status: 'Waiting',
      createdAt: serverTimestamp(),
      createdBy: user.uid,
    });
  }, [user]);

  const updateCall = useCallback(async (callId, updates) => {
    if (!user) throw new Error('Not authenticated');
    const ref = doc(db, CALLS_PATH, callId);
    return updateDoc(ref, {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  }, [user]);

  const resolveCall = useCallback(async (callId) => {
    if (!user) throw new Error('Not authenticated');
    const ref = doc(db, CALLS_PATH, callId);
    return updateDoc(ref, {
      status: 'Resolved',
      resolvedAt: serverTimestamp(),
      resolvedBy: user.uid,
    });
  }, [user]);

  const deleteCall = useCallback(async (callId) => {
    if (!user) throw new Error('Not authenticated');
    const ref = doc(db, CALLS_PATH, callId);
    return deleteDoc(ref);
  }, [user]);

  const activeCalls = calls.filter((c) => c.status !== 'Resolved');
  const resolvedCalls = calls.filter((c) => c.status === 'Resolved');

  return {
    calls,
    activeCalls,
    resolvedCalls,
    loading,
    addCall,
    updateCall,
    resolveCall,
    deleteCall,
  };
}
