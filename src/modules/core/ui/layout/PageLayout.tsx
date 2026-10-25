import React from 'react';
import { motion, type MotionProps } from 'framer-motion';
import { cn } from '@/modules/core/lib/utils';
import { page, surface } from './pageTokens';

interface PageBodyProps {
  children: React.ReactNode;
  className?: string;
  /** Use when the body should scroll internally (default). Set false for grid-canvas pages. */
  scrollable?: boolean;
  /** Render body as a plain container without the glassmorphic card shell. */
  bare?: boolean;
}

interface PageFooterProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * The motion props let a page keep its staggered entrance (Profile, My
 * Attendance, the employee bid/swap pages put `pageVariants` on their root).
 * Without them the root is inert and children render statically, as before.
 */
type PageLayoutProps = {
  children: React.ReactNode;
  className?: string;
  /**
   * Drop the gutter for a full-screen mode that hides the header (Broadcast
   * Center's control room). A prop, not `className="p-0"`: tailwind-merge only
   * resolves conflicts within one breakpoint, so `md:pb-4` / `lg:p-6` would
   * survive a plain `p-0`.
   */
  bleed?: boolean;
} & Pick<MotionProps, 'variants' | 'initial' | 'animate'>;

/**
 * Gold-Standard page shell:
 *   root   → fills <main>; owns the gutter and the 16px gap between regions
 *   header → GoldStandardHeader, the only header (glass card, title, scope, toolbar)
 *   body   → flex-1 min-h-0, glassmorphic card with p-4 lg:p-6
 *   footer → flex-shrink-0, optional (summary / metrics bars)
 *
 * Usage:
 *   <PageLayout>
 *     <GoldStandardHeader ... />
 *     <PageLayout.Body>   ... </PageLayout.Body>
 *     <PageLayout.Footer> ... </PageLayout.Footer>
 *   </PageLayout>
 */
const PageLayout: React.FC<PageLayoutProps> & {
  Body: React.FC<PageBodyProps>;
  Footer: React.FC<PageFooterProps>;
} = ({ children, className, bleed = false, ...motionProps }) => (
  // gap, not space-y: margins land on whatever the first rendered child is,
  // so a conditional banner or footer shifted the spacing around it.
  <motion.div {...motionProps} className={cn(page.root, !bleed && page.gutter, page.gap, className)}>
    {children}
  </motion.div>
);

const PageBody: React.FC<PageBodyProps> = ({
  children,
  className,
  scrollable = true,
  bare = false,
}) => {
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
        'flex-1 min-h-0 scrollbar-none',
        page.bodyInset,
        scrollable ? 'overflow-auto' : 'overflow-hidden',
        surface.bodyCard,
        className,
      )}
    >
      {children}
    </div>
  );
};

const PageFooter: React.FC<PageFooterProps> = ({ children, className }) => (
  <div className={cn('flex-shrink-0', className)}>{children}</div>
);

PageLayout.Body = PageBody;
PageLayout.Footer = PageFooter;

export { PageLayout };
