import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import AppLayout from '@/modules/core/ui/layout/AppLayout';
import { useAuth } from '@/platform/auth/useAuth';
import { MobileAccessGuard } from '@/modules/core/ui/components/MobileAccessGuard';

/* =======================
   EAGER LOADED PAGES
   ======================= */
import Index from '@/modules/core/pages/Index';
import LoginPage from '@/modules/auth/pages/LoginPage';

/* =======================
   LAZY LOADED PAGES
   ======================= */
// Admin / Auth Utilities
const UnauthorizedPage = lazy(() => import('@/modules/auth/pages/UnauthorizedPage'));
const PendingAccessPage = lazy(() => import('@/modules/auth/pages/PendingAccessPage'));
const SignUpPage = lazy(() => import('@/modules/auth/pages/SignUpPage'));
const NotFound = lazy(() => import('@/modules/core/pages/NotFound'));

// Dashboard
const DashboardPage = lazy(() => import('@/modules/dashboard/pages/DashboardPage'));

// My Workspace
const ProfilePage = lazy(() => import('@/modules/users/pages/ProfilePage'));
const MyRosterPage = lazy(() => import('@/modules/rosters/pages/MyRosterPage'));
const AvailabilityPage = lazy(() => import('@/modules/availability/pages/AvailabilityPage'));
const EmployeeBidsPage = lazy(() => import('@/modules/planning/bidding/ui/pages/EmployeeBids.page'));
const EmployeeSwapsPage = lazy(() => import('@/modules/planning/swapping/ui/pages/EmployeeSwaps.page'));
const MyBroadcastsPage = lazy(() => import('@/modules/broadcasts/ui/pages/MyBroadcastsPage'));
const AttendancePage = lazy(() => import('@/modules/rosters/pages/AttendancePage'));
const MyNotificationsPage = lazy(() => import('@/modules/core/pages/MyNotificationsPage'));

// Rostering
const TemplatesPage = lazy(() => import('@/modules/templates/pages/TemplatesPage'));
const RostersPlannerPage = lazy(() => import('@/modules/rosters/pages/RostersPlannerPage'));
const LaborDemandForecastingPage = lazy(() => import('@/modules/rosters/pages/LaborDemandForecastingPage'));
const TimesheetPage = lazy(() => import('@/modules/timesheets/ui/TimesheetPage'));

// Management
const ManagerBidsPage = lazy(() => import('@/modules/planning/bidding/ui/pages/ManagerBids.page'));
const ManagerSwapsPage = lazy(() => import('@/modules/planning/swapping/ui/pages/ManagerSwaps.page'));
const BroadcastManagerPage = lazy(() => import('@/modules/broadcasts/ui/pages/BroadcastsManager.page'));

// Features
const InsightsPage = lazy(() => import('@/modules/insights/pages/InsightsPage'));
const AnalysisPage = lazy(() => import('@/modules/insights/pages/AnalysisPage'));
const GridPage = lazy(() => import('@/modules/insights/pages/GridPage'));
const ContractsPage = lazy(() => import('@/modules/contracts/pages/ContractsPage'));
const UsersPage = lazy(() => import('@/modules/users/pages/UsersPage'));
const PerformancePage = lazy(() => import('@/modules/users/pages/PerformancePage'));
const AuditDashboardPage = lazy(() => import('@/modules/audit/pages/AuditDashboardPage'));

// Utility
const SearchPage = lazy(() => import('@/modules/search/pages/SearchPage'));

/* =======================
   LOADING FALLBACK
   ======================= */
const PageLoader: React.FC = () => (
    <div className="flex items-center justify-center h-screen">
        <div className="flex flex-col items-center gap-4">
            <div className="h-10 w-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
    </div>
);

/* =======================
   ROUTES WHERE MAIN AREA HAS NO PADDING (fullscreen canvas pages)
   ======================= */
const NO_PADDING_ROUTES = new Set(['/my-roster', '/rosters']);

/* =======================
   PERSISTENT AUTH LAYOUT
   Renders once and stays mounted across all protected navigations.
   AppSidebar no longer remounts on every route change.
   ======================= */
const AuthLayout: React.FC = () => {
    const { user, isAuthenticated, isLoading, hasActiveContracts } = useAuth();
    const location = useLocation();
    const noPadding = NO_PADDING_ROUTES.has(location.pathname);

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-4">
                    <div className="h-10 w-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                    <p className="text-muted-foreground text-sm">Loading...</p>
                </div>
            </div>
        );
    }

    if (!isAuthenticated || !user) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    if (!hasActiveContracts) {
        return <Navigate to="/pending-access" replace />;
    }

    return (
        <AppLayout noPadding={noPadding}>
            <Suspense fallback={<PageLoader />}>
                <Outlet />
            </Suspense>
        </AppLayout>
    );
};

/* =======================
   FEATURE GATE
   Optional per-route permission check — wraps child routes that need
   a specific feature permission. Redirects to /unauthorized if denied.
   ======================= */
const FeatureGate: React.FC<{ feature: string }> = ({ feature }) => {
    const { hasPermission } = useAuth();
    if (!hasPermission(feature)) {
        return <Navigate to="/unauthorized" replace />;
    }
    return <Outlet />;
};

/* =======================
   APP ROUTER
   ======================= */
const AppRouter: React.FC = () => {
    return (
        <Routes>
            {/* ================= Public ================= */}
            <Route path="/" element={<Index />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/unauthorized" element={<Suspense fallback={<PageLoader />}><UnauthorizedPage /></Suspense>} />
            <Route path="/pending-access" element={<Suspense fallback={<PageLoader />}><PendingAccessPage /></Suspense>} />
            <Route path="/signup" element={<Suspense fallback={<PageLoader />}><SignUpPage /></Suspense>} />

            {/* ================= Protected (persistent layout) =================
                All child routes share ONE AppLayout + AppSidebar instance.
                Navigating between them no longer remounts the sidebar.
            ================= */}
            <Route element={<AuthLayout />}>

                {/* MobileAccessGuard: blocks non-workspace paths on mobile viewports */}
                <Route element={<MobileAccessGuard />}>

                    {/* ── Dashboard ── */}
                    <Route path="/dashboard" element={<DashboardPage />} />

                    {/* ── My Workspace ── */}
                    <Route path="/profile" element={<ProfilePage />} />
                    <Route path="/my-roster" element={<MyRosterPage />} />
                    <Route path="/attendance" element={<AttendancePage />} />
                    <Route path="/availabilities" element={<AvailabilityPage />} />
                    <Route path="/bids" element={<EmployeeBidsPage />} />
                    <Route path="/my-swaps" element={<EmployeeSwapsPage />} />
                    <Route path="/my-notifications" element={<MyNotificationsPage />} />

                    <Route element={<FeatureGate feature="my-broadcasts" />}>
                        <Route path="/my-broadcasts" element={<MyBroadcastsPage />} />
                    </Route>

                    {/* ── Rostering ── */}
                    <Route element={<FeatureGate feature="templates" />}>
                        <Route path="/templates" element={<TemplatesPage />} />
                    </Route>

                    <Route element={<FeatureGate feature="rosters" />}>
                        <Route path="/rosters" element={<RostersPlannerPage />} />
                        <Route path="/labor-demand" element={<LaborDemandForecastingPage />} />
                    </Route>

                    <Route element={<FeatureGate feature="timesheet-view" />}>
                        <Route path="/timesheet" element={<TimesheetPage />} />
                    </Route>

                    {/* ── Management ── */}
                    <Route element={<FeatureGate feature="management" />}>
                        <Route path="/management/bids" element={<ManagerBidsPage />} />
                        <Route path="/management/swaps" element={<ManagerSwapsPage />} />
                        <Route path="/performance" element={<PerformancePage />} />
                        <Route path="/audit" element={<AuditDashboardPage />} />
                    </Route>

                    {/* ── Broadcast ── */}
                    <Route element={<FeatureGate feature="broadcast" />}>
                        <Route path="/broadcast" element={<BroadcastManagerPage />} />
                    </Route>

                    {/* ── Insights ── */}
                    <Route element={<FeatureGate feature="insights" />}>
                        <Route path="/insights" element={<InsightsPage />} />
                        <Route path="/insights/:metricId" element={<AnalysisPage />} />
                        <Route path="/grid" element={<GridPage />} />
                    </Route>

                    {/* ── Admin ── */}
                    <Route element={<FeatureGate feature="configurations" />}>
                        <Route path="/contracts" element={<ContractsPage />} />
                    </Route>

                    <Route element={<FeatureGate feature="users" />}>
                        <Route path="/users" element={<UsersPage />} />
                    </Route>

                    {/* ── Utility ── */}
                    <Route path="/search" element={<SearchPage />} />

                </Route>{/* /MobileAccessGuard */}

            </Route>

            {/* ================= Catch All ================= */}
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
};

export default AppRouter;
