// API
export * from './api/insights.api';

// Models
export * from './model/metric.types';

// State
export * from './state/useInsights';
export * from './state/useMetric';
export * from './state/useMetricTrend';

// Pages
export { default as InsightsPage } from './pages/InsightsPage';

// Views
export { default as WorkforceUtilizationView } from './ui/views/WorkforceUtilizationView';
export { default as EventLevelMetricsView } from './ui/views/EventLevelMetricsView';
export { default as TimeAttendanceView } from './ui/views/TimeAttendanceView';
export { default as EmployeeBehaviorView } from './ui/views/EmployeeBehaviorView';
export { default as SchedulingEfficiencyView } from './ui/views/SchedulingEfficiencyView';
export { default as CommunicationInteractionView } from './ui/views/CommunicationInteractionView';
export { default as FinancialBudgetView } from './ui/views/FinancialBudgetView';
export { default as ForecastingPlanningView } from './ui/views/ForecastingPlanningView';
export { default as LocationBasedView } from './ui/views/LocationBasedView';
export { default as ChartsView } from './ui/views/ChartsView';
export { default as DepartmentSpecificView } from './ui/views/DepartmentSpecificView';

// Components
export { default as InsightMetricCard } from './ui/components/InsightMetricCard';
