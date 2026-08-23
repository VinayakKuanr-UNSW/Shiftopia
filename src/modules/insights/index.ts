// API
export * from './api/insights.api';

// Models
export * from './model/metric.types';
export * from './model/metric-registry';

// State
export * from './state/useInsights';
export * from './state/useMetric';
export * from './state/useMetricTrend';

// Filters
export * from './hooks/useKpiFilters';

// Pages
export { default as InsightsPage } from './pages/InsightsPage';
export { default as PerformancePage } from './pages/PerformancePage';

// The eleven `*View` components that used to be exported here were placeholder
// shells with no data layer and no importers outside this barrel — roughly 800
// lines that looked like a feature. They are deleted, along with
// InsightMetricCard (imported only by them) and WorkforceTab, whose metrics
// moved onto the Attendance, Cancellations and Overview tabs.
