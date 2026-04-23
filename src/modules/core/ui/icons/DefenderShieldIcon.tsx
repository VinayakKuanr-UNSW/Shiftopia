import React from 'react';

interface DefenderShieldIconProps {
  className?: string;
  size?: number | string;
}

/**
 * Windows Defender style shield icon divided into 4 quadrants.
 */
export const DefenderShieldIcon: React.FC<DefenderShieldIconProps> = ({ 
  className, 
  size = "1em" 
}) => {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="currentColor" 
      xmlns="http://www.w3.org/2000/svg" 
      className={className}
    >
      {/* 
        Horizontal & Vertical gaps are approx 1 unit wide on a 24-unit grid.
        Midpoint is 12. Gaps at 11.5 - 12.5.
      */}
      
      {/* Top-Left Quadrant */}
      <path d="M11.5 3.2V11.5H4.2V10.8C4.2 8.7 5.5 6.4 11.5 3.2Z" />
      
      {/* Top-Right Quadrant */}
      <path d="M12.5 3.2V11.5H19.8V10.8C19.8 8.7 18.5 6.4 12.5 3.2Z" />
      
      {/* Bottom-Left Quadrant */}
      <path d="M4.2 12.5H11.5V21.5C8.1 20.3 4.2 17.5 4.2 13.2V12.5Z" />
      
      {/* Bottom-Right Quadrant */}
      <path d="M12.5 12.5H19.8V13.2C19.8 17.5 15.9 20.3 12.5 21.5V12.5Z" />
    </svg>
  );
};
