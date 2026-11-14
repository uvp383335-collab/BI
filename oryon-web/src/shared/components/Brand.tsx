import React from 'react'

/** Oryon AI wordmark: three-point constellation + serif name. Drawn for the dark sidebar. */
export const Brand: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <div className="brand">
    <svg width={size + 6} height={size - 2} viewBox="0 0 30 22" aria-hidden="true">
      <line x1="5" y1="17" x2="25" y2="5" stroke="#4A5F80" strokeWidth="1" />
      <circle cx="5" cy="17" r="2.4" fill="#F2F4F8" />
      <circle cx="15" cy="11" r="3" fill="#DDB35A" />
      <circle cx="25" cy="5" r="2.4" fill="#F2F4F8" />
    </svg>
    <b style={{ fontSize: size }}>Oryon AI</b>
  </div>
)
