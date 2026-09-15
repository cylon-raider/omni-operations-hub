import React from 'react';
import { getSentimentLabel } from '../utils/sentiment';

// Angle convention: 0deg = 12 o'clock (top), positive = clockwise. The gauge
// only draws the top semicircle, from -90 (9 o'clock, fully negative)
// through 0 (top, neutral) to +90 (3 o'clock, fully positive).
function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

const ZONES = [
  { from: -90, to: -30, color: '#ef4444' },
  { from: -30, to: 30, color: '#f59e0b' },
  { from: 30, to: 90, color: '#22c55e' },
];

const CX = 50;
const CY = 48;
const R = 38;

/**
 * A semicircular sentiment gauge with a needle positioned continuously
 * along the arc (not snapped to the three color zones), so a score between
 * two zones (e.g. leaning positive but not fully) reads as an in-between
 * needle position rather than jumping straight to "positive".
 */
export default function SentimentGauge({ score, size = 'sm' }) {
  if (score === null || score === undefined) return null;

  const clamped = Math.max(-1, Math.min(1, score));
  const needleAngle = clamped * 90;
  const strokeWidth = size === 'lg' ? 10 : 8;
  const needleLen = R - strokeWidth - 2;
  const needleTip = polarToCartesian(CX, CY, needleLen, needleAngle);
  const dims = size === 'lg' ? 'w-32 h-[70px]' : 'w-10 h-6';
  const label = getSentimentLabel(clamped);

  return (
    <div className={`relative ${dims}`} title={`${label} (${clamped.toFixed(2)})`}>
      <svg viewBox="0 0 100 55" className="w-full h-full overflow-visible">
        {ZONES.map((z) => (
          <path
            key={z.color}
            d={describeArc(CX, CY, R, z.from, z.to)}
            fill="none"
            stroke={z.color}
            strokeWidth={strokeWidth}
          />
        ))}
        <line
          x1={CX}
          y1={CY}
          x2={needleTip.x}
          y2={needleTip.y}
          stroke="#374151"
          strokeWidth={size === 'lg' ? 2.5 : 2}
          strokeLinecap="round"
        />
        <circle cx={CX} cy={CY} r={size === 'lg' ? 4 : 3} fill="#374151" />
      </svg>
    </div>
  );
}
