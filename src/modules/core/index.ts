/**
 * Core Module - Public API
 * Core application pages and foundational components
 */

// Pages

// Providers
export { default as ProviderWrapper } from './providers/ProviderWrapper';

// UI Components
export { ErrorBoundary } from './ui/components/ErrorBoundary';
// PageState covers expected async states (loading / error / empty); ErrorBoundary
// covers unexpected render-time exceptions. They are complementary, not rivals.
