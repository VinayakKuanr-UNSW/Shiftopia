/**
 * Core Module - Public API
 * Core application pages and foundational components
 */

// Pages
export { default as Index } from './pages/Index';
export { default as NotFound } from './pages/NotFound';

// Providers
export { default as ProviderWrapper } from './providers/ProviderWrapper';

// UI Components
export { ErrorBoundary } from './ui/components/ErrorBoundary';
// PageState covers expected async states (loading / error / empty); ErrorBoundary
// covers unexpected render-time exceptions. They are complementary, not rivals.
export { PageState } from './ui/components/PageState';
export type { PageStateKind, PageStateProps, PageStateScope } from './ui/components/PageState';
