import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2, type LucideIcon } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';

export type PageStateKind = 'loading' | 'error' | 'empty';
export type PageStateScope = 'page' | 'section' | 'inline';

export interface PageStateAction {
  label: string;
  onClick: () => void;
}

export interface PageStateProps {
  /** The request state to communicate. Render content separately once it is ready. */
  state: PageStateKind;
  /** `page` fills a page region; `section` and `inline` fit embedded data areas. */
  scope?: PageStateScope;
  title?: ReactNode;
  description?: ReactNode;
  /** A layout-aware loading placeholder. Prefer this over a generic spinner for data-heavy views. */
  skeleton?: ReactNode;
  /** Repeats the failed request. Only relevant for error states. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Optional primary next step, most useful for empty states. */
  action?: PageStateAction;
  icon?: LucideIcon;
  className?: string;
}

const defaults: Record<PageStateKind, { title: string; description: string; Icon: LucideIcon }> = {
  loading: {
    title: 'Loading',
    description: 'We’re getting things ready for you.',
    Icon: Loader2,
  },
  error: {
    title: 'Something went wrong',
    description: 'We couldn’t load this information. Please try again.',
    Icon: AlertTriangle,
  },
  empty: {
    title: 'Nothing here yet',
    description: 'There is no information to show right now.',
    Icon: Inbox,
  },
};

const scopeClasses: Record<PageStateScope, string> = {
  page: 'min-h-[calc(100vh-8rem)] px-6 py-12',
  section: 'min-h-[16rem] px-6 py-10',
  inline: 'min-h-[8rem] px-4 py-6',
};

/**
 * Consistent asynchronous page, panel, and inline request state.
 *
 * It deliberately does not catch rendering exceptions; use ErrorBoundary for that.
 */
export function PageState({
  state,
  scope = 'section',
  title,
  description,
  skeleton,
  onRetry,
  retryLabel = 'Try again',
  action,
  icon,
  className,
}: PageStateProps) {
  const fallback = defaults[state];
  const Icon = icon ?? fallback.Icon;
  const resolvedTitle = title ?? fallback.title;
  const resolvedDescription = description ?? fallback.description;

  if (state === 'loading' && skeleton) {
    return (
      <div
        className={cn(scopeClasses[scope], className)}
        role="status"
        aria-live="polite"
        aria-busy="true"
        aria-label={typeof resolvedTitle === 'string' ? resolvedTitle : 'Loading'}
      >
        {skeleton}
      </div>
    );
  }

  return (
    <section
      className={cn(
        'flex w-full flex-col items-center justify-center text-center',
        scopeClasses[scope],
        className,
      )}
      role={state === 'error' ? 'alert' : state === 'loading' ? 'status' : undefined}
      aria-live={state === 'empty' ? 'polite' : undefined}
      aria-busy={state === 'loading' || undefined}
    >
      <div
        className={cn(
          'mb-4 flex h-12 w-12 items-center justify-center rounded-full',
          state === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary',
        )}
        aria-hidden="true"
      >
        <Icon className={cn('h-6 w-6', state === 'loading' && 'animate-spin')} />
      </div>
      <h2 className="text-base font-semibold text-foreground">{resolvedTitle}</h2>
      {resolvedDescription && (
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{resolvedDescription}</p>
      )}
      {(onRetry || action) && (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {onRetry && <Button type="button" variant="outline" onClick={onRetry}>{retryLabel}</Button>}
          {action && <Button type="button" onClick={action.onClick}>{action.label}</Button>}
        </div>
      )}
    </section>
  );
}

export default PageState;
