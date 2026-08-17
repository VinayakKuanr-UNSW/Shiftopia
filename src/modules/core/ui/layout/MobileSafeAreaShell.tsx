import React from 'react';
import { cn } from '@/modules/core/lib/utils';

interface MobileSafeAreaShellProps {
  children: React.ReactNode;
  className?: string;
}

const MobileSafeAreaShell: React.FC<MobileSafeAreaShellProps> = ({
  children,
  className,
}) => {
  return (
    <div className={cn('min-h-0 h-full w-full mobile-safe-area-shell', className)}>
      {children}
    </div>
  );
};

export default MobileSafeAreaShell;
