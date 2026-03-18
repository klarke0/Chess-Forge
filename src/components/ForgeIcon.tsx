import React, { useId } from 'react';

interface ForgeIconProps {
  size?: number;
}

export const ForgeIcon: React.FC<ForgeIconProps> = ({ size = 20 }) => {
  const uid = useId();
  const gradientId = `forge-flame-${uid}`;

  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none">
      <defs>
        <linearGradient id={gradientId} x1="12" y1="21.5" x2="12" y2="1.5" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#dc2626" />
          <stop offset="55%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#fcd34d" stopOpacity="0.85" />
        </linearGradient>
      </defs>

      {/* Flame Background */}
      <path
        d="M12 1.5C12 1.5 4.5 7.5 4.5 14C4.5 18.142 7.858 21.5 12 21.5C16.142 21.5 19.5 18.142 19.5 14C19.5 7.5 12 1.5 12 1.5Z"
        fill={`url(#${gradientId})`}
      />

      {/* Pawn Head */}
      <circle cx="12" cy="7.25" r="2" fill="white" />
      
      {/* Pawn Collar */}
      <rect x="9.5" y="9.5" width="5" height="1.25" rx="0.5" fill="white" />
      
      {/* Pawn Body */}
      <path d="M10.5 10.75h3c0 0 .5 3.5 2.25 5v1H8.25v-1c1.75-1.5 2.25-5 2.25-5z" fill="white" />
      
      {/* Pawn Base */}
      <rect x="7.5" y="17" width="9" height="1.75" rx="0.5" fill="white" />
    </svg>
  );
};
