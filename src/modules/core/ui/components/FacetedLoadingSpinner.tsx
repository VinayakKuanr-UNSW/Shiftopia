import React from 'react';
import { cn } from '@/modules/core/lib/utils';
import ringImage from '@/assets/images/faceted-loading-ring.png';

interface FacetedLoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  ringClassName?: string;
  label?: string;
}

const SIZE_MAP: Record<'sm' | 'md' | 'lg' | 'xl', string> = {
  sm: 'h-5 w-5',
  md: 'h-10 w-10',
  lg: 'h-14 w-14',
  xl: 'h-20 w-20',
};

/**
 * Faceted Multicolor Loading Spinner
 * Renders the faceted color ring with a smooth 360-degree rotation.
 */
export const FacetedLoadingSpinner: React.FC<FacetedLoadingSpinnerProps> = ({
  size = 'md',
  className,
  ringClassName,
  label,
}) => {
  const sizeClass = SIZE_MAP[size] || SIZE_MAP.md;

  return (
    <div className={cn('flex flex-col items-center justify-center gap-3.5 select-none', className)}>
      <div className={cn('relative flex items-center justify-center', sizeClass)}>
        {/* Soft subtle glow behind the ring */}
        <div className="absolute inset-0 bg-primary/10 dark:bg-primary/20 rounded-full blur-md pointer-events-none" />
        
        {/* Rotating faceted multicolor ring */}
        <img
          src={ringImage}
          alt="Loading..."
          className={cn(
            'w-full h-full object-contain animate-spin select-none pointer-events-none [animation-duration:1s]',
            ringClassName
          )}
          loading="eager"
        />
      </div>

      {label && (
        <span className="text-[11px] font-mono text-muted-foreground/40 uppercase tracking-[0.3em]">
          {label}
        </span>
      )}
    </div>
  );
};

