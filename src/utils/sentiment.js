// Shared sentiment-scoring logic, used by SentimentGauge.jsx (per-call
// display) and SentimentTrendsCard.jsx (aggregation), so the two views can't
// drift out of sync about what a given call's sentiment score is.
//
// New calls (see functions/index.js's GPT prompt) get a continuous
// `sentimentScore` from -1 (very negative) to 1 (very positive) directly
// from the AI, alongside the free-text `sentiment` label it's always
// produced ("Frustrated", "Neutral", "Happy", etc). Calls processed before
// that field existed only have the text label — SENTIMENT_LABEL_SCORES maps
// those same 24 labels (covering effectively every historical call) to an
// equivalent score, so every call with a transcript gets a gauge without
// needing to re-run AI analysis or backfill Firestore.
const SENTIMENT_LABEL_SCORES = {
  neutral: 0,
  positive: 0.6,
  happy: 0.8,
  frustrated: -0.6,
  urgent: -0.2,
  concerned: -0.35,
  apologetic: -0.15,
  negative: -0.8,
  relieved: 0.5,
  confused: -0.25,
  caring: 0.5,
  sad: -0.5,
  understanding: 0.2,
  grateful: 0.7,
  anxious: -0.4,
  sympathetic: 0.3,
  cautious: -0.1,
  nervous: -0.35,
  overwhelmed: -0.55,
  content: 0.5,
  friendly: 0.6,
  disappointed: -0.5,
  helpful: 0.5,
  calm: 0.3,
};

/**
 * Returns a call's sentiment as a number from -1 to 1, or null if the call
 * has no usable sentiment data (no transcript, or an unrecognized label).
 */
export function getSentimentScore(call) {
  if (typeof call.sentimentScore === 'number' && !Number.isNaN(call.sentimentScore)) {
    return Math.max(-1, Math.min(1, call.sentimentScore));
  }
  if (call.sentiment) {
    const key = call.sentiment.trim().toLowerCase();
    if (key in SENTIMENT_LABEL_SCORES) return SENTIMENT_LABEL_SCORES[key];
  }
  return null;
}

/**
 * Buckets a score into a 5-point label, so "leaning positive but not fully
 * happy" reads as "Positive" rather than being forced into just three bins.
 */
export function getSentimentLabel(score) {
  if (score === null || score === undefined) return null;
  if (score <= -0.6) return 'Very Negative';
  if (score <= -0.2) return 'Negative';
  if (score < 0.2) return 'Neutral';
  if (score < 0.6) return 'Positive';
  return 'Very Positive';
}

/** Coarser 3-way bucket, used for the distribution bar on the trends card. */
export function getSentimentBucket(score) {
  if (score <= -0.2) return 'negative';
  if (score < 0.2) return 'neutral';
  return 'positive';
}
