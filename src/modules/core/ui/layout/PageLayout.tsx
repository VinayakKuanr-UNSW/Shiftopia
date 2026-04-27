import React from 'react';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';

interface PageHeaderProps {
  children: React.ReactNode;
  className?: string;
}

interface PageBodyProps {
  children: React.ReactNode;
  className?: string;
  /** Use when the body should scroll internally (default). Set false for grid-canvas pages. */
  scrollable?: boolean;
  /** Render body as a plain container without the glassmorphic card shell. */
  bare?: boolean;
}

interface PageLayoutProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Gold-Standard page shell:
 *   root  → h-full flex-col overflow-hidden p-4 lg:p-6 space-y-4
 *   header → flex-shrink-0 (sticky-within-flex)
 *   body   → flex-1 min-h-0, glassmorphic card with p-4 lg:p-6
 *
 * Usage:
 *   <PageLayout>
 *     <PageLayout.Header> ... </PageLayout.Header>
 *     <PageLayout.Body>   ... </PageLayout.Body>
 *   </PageLayout>
 */
const PageLayout: React.FC<PageLayoutProps> & {
  Header: React.FC<PageHeaderProps>;
  Body: React.FC<PageBodyProps>;
} = ({ children, className }) => (
  <div className={cn('h-full flex flex-col overflow-hidden p-4 lg:p-6 space-y-4', className)}>
    {children}
  </div>
);

const PageHeader: React.FC<PageHeaderProps> = ({ children, className }) => {
  const { isDark } = useTheme();
  return (
    <div className="flex-shrink-0">
      <div
        className={cn(
          'rounded-[32px] p-4 lg:p-6 transition-all border',
          isDark
            ? 'bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20'
            : 'bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
};

const PageBody: React.FC<PageBodyProps> = ({
  children,
  className,
  scrollable = true,
  bare = false,
}) => {
  const { isDark } = useTheme();

  if (bare) {
    return (
      <div className={cn('flex-1 min-h-0', scrollable && 'overflow-y-auto', className)}>
        {children}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex-1 min-h-0 rounded-[32px] transition-all border p-4 lg:p-6 scrollbar-none',
        scrollable ? 'overflow-auto' : 'overflow-hidden',
        isDark
          ? 'bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20'
          : 'bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50',
        className,
      )}
    >
      {children}
    </div>
  );
};

PageLayout.Header = PageHeader;
PageLayout.Body = PageBody;

export { PageLayout };
