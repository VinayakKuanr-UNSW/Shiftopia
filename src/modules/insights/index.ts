/**
 * KPI module — public surface.
 *
 * The directory is still `insights` and the route is still `/insights`; only
 * the user-facing label became "KPI". Renaming either would touch the
 * permission key, the mobile route allowlist and ten RPC names for no
 * behavioural gain.
 *
 * What belongs here is what another module may legitimately reach for. This
 * barrel used to `export *` from every folder including three `@deprecated`
 * stubs, which is how those stubs — and the superseded MetricId catalogue they
 * depended on — stayed alive with no real consumer. Internals are deep-imported
 * within the module and should not be re-exported.
 */

// The two routed pages. AppRouter lazy-imports these by path, so this is a
// convenience surface rather than the load-bearing one.
export { default as InsightsPage } from './pages/InsightsPage';
export { default as PerformancePage } from './pages/PerformancePage';

// The one metric catalogue. Anything rendering a KPI outside this module —
// the Attendance scorecard on My Attendance and Timesheets, for instance —
// should grade and format through these rather than inventing thresholds.
export {
    METRIC_REGISTRY,
    statusFor,
    labelFor,
    formatMetric,
    analysisMetricId,
    analysisHref,
    type MetricStatus,
    type MetricFormat,
    type MetricSpec,
} from './model/metric-registry';

// Quarter helpers. Shared so a caller cannot re-derive quarter boundaries from
// the device clock, which is the bug useDateRange used to carry.
export {
    makeQuarter,
    previousQuarter,
    recentQuarters,
    quarterBounds,
    type QuarterRef,
    type KpiFilters,
} from './hooks/useKpiFilters';

// Row shapes the RPCs return, for anyone typing against them.
export type {
    InsightsFilters,
    InsightsSummary,
    TrendRow,
    DeptBreakdownRow,
} from './model/metric.types';
