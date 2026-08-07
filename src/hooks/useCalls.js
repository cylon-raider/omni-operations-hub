// -----------------------------------------------------------------------------
// useCalls.js (Custom React Hook)
// -----------------------------------------------------------------------------
// This file is the bridge between our React frontend and our Firebase database.
// It uses a "Real-time Listener" so that whenever a call is added, updated, or
// deleted in the database, our React app updates instantly without refreshing.
// -----------------------------------------------------------------------------
import { useState, useEffect, useCallback } from 'react';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, query, orderBy, where
} from 'firebase/firestore';
import { db, APP_ID } from '../config/firebase';

const CALLS_PATH = `artifacts/${APP_ID}/public/data/calls`;

// --------------------------------------------------------------------------
// The Main Hook Function
// --------------------------------------------------------------------------
export function useCalls(user, location = 'glendale') {
  // We store the raw list of calls here
  const [calls, setCalls] = useState([]);
  // We track whether we are currently waiting for the first database response
  const [loading, setLoading] = useState(true);

  // --------------------------------------------------------------------------
  // Real-time Database Listener
  // --------------------------------------------------------------------------
  // The useEffect hook runs automatically when the component loads, or whenever
  // the `user` or `location` variables change.
  useEffect(() => {
    // If the user isn't logged in, don't try to fetch data.
    if (!user) {
      setCalls([]);
      setLoading(false);
      return;
    }

    // Step 1: Create a "Query". We ask Firebase for all calls located at the
    // currently selected office (e.g., "glendale").
    const q = query(
      collection(db, CALLS_PATH),
      where('location', '==', location)
    );

    // Step 2: Set up the Listener (`onSnapshot`)
    // Firebase will immediately send us the current list of calls.
    // It will ALSO send us a brand new list anytime someone else changes the database!
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items = [];
        // Loop through the raw database records and format them into Javascript objects
        snapshot.forEach((d) => items.push({ id: d.id, ...d.data() }));
        
        // Define how important each priority level is for sorting
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

    // This "cleanup function" runs when the user leaves the page or changes location.
    // It tells Firebase to stop sending us updates, saving battery and data!
    return () => unsubscribe();
  }, [user, location]);

  // --------------------------------------------------------------------------
  // Database Write Functions
  // --------------------------------------------------------------------------
  // These functions actually modify the database. Because we have a listener
  // running above, we don't need to manually update our local state! We just 
  // write to Firebase, and the listener instantly updates the screen for us.

  // CREATE a new call
  const addCall = useCallback(async (callData) => {
    if (!user) throw new Error('Not authenticated');
    return addDoc(collection(db, CALLS_PATH), {
      ...callData,
      status: 'Waiting',
      createdAt: serverTimestamp(), // Let the Google servers stamp the exact time
      createdBy: user.uid,
    });
  }, [user]);

  // UPDATE an existing call (e.g., claiming a call)
  const updateCall = useCallback(async (callId, updates) => {
    if (!user) throw new Error('Not authenticated');
    const ref = doc(db, CALLS_PATH, callId);
    return updateDoc(ref, {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  }, [user]);

  // MARK a call as resolved
  const resolveCall = useCallback(async (callId) => {
    if (!user) throw new Error('Not authenticated');
    const ref = doc(db, CALLS_PATH, callId);
    return updateDoc(ref, {
      status: 'Resolved',
      resolvedAt: serverTimestamp(),
      resolvedBy: user.uid,
    });
  }, [user]);

  // DELETE a call permanently
  const deleteCall = useCallback(async (callId) => {
    if (!user) throw new Error('Not authenticated');
    const ref = doc(db, CALLS_PATH, callId);
    return deleteDoc(ref);
  }, [user]);

  // --------------------------------------------------------------------------
  // Data Filtering
  // --------------------------------------------------------------------------
  // We split the master list of calls into two lists for the UI: active and resolved.
  
  const resolvedCalls = calls.filter((c) => {
    if (c.status !== 'Resolved') return false;
    
    const now = new Date();
    const resolvedTime = c.resolvedAt?.toMillis 
      ? c.resolvedAt.toMillis() 
      : (c.updatedAt?.toMillis ? c.updatedAt.toMillis() : 0);
      
    if (resolvedTime === 0) return false;
    
    const resolvedDate = new Date(resolvedTime);
    return resolvedDate.getDate() === now.getDate() &&
           resolvedDate.getMonth() === now.getMonth() &&
           resolvedDate.getFullYear() === now.getFullYear();
  });

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
