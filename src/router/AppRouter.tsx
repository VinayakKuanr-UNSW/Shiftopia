import React, { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import AppLayout from '@/modules/core/ui/layout/AppLayout';
import ProtectedRoute from '@/modules/auth/ui/ProtectedRoute';

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

// Rostering
const TemplatesPage = lazy(() => import('@/modules/templates/pages/TemplatesPage'));
const RostersPlannerPage = lazy(() => import('@/modules/rosters/pages/RostersPlannerPage'));
const LaborDemandForecastingPage = lazy(() => import('@/modules/rosters/pages/LaborDemandForecastingPage'));
const TimesheetPage = lazy(() => import('@/modules/timesheets/ui/TimesheetPage'));
const AuditTrailPage = lazy(() => import('@/modules/audit/pages/AuditTrailPage'));

// Audit
const AuditDashboardPage = lazy(() => import('@/modules/audit/pages/AuditDashboardPage'));
const ShiftDetailView = lazy(() => import('@/modules/audit/pages/ShiftDetailView'));

// Management
const ManagerBidsPage = lazy(() => import('@/modules/planning/bidding/ui/pages/ManagerBids.page'));
const ManagerSwapsPage = lazy(() => import('@/modules/planning/swapping/ui/pages/ManagerSwaps.page'));

// ✅ Broadcast (Manager)
const BroadcastManagerPage = lazy(() => import('@/modules/broadcasts/ui/pages/BroadcastsManager.page'));

// Features
const InsightsPage = lazy(() => import('@/modules/insights/pages/InsightsPage'));
const AnalysisPage = lazy(() => import('@/modules/insights/pages/AnalysisPage'));

const ContractsPage = lazy(() => import('@/modules/contracts/pages/ContractsPage'));
const UsersPage = lazy(() => import('@/modules/users/pages/UsersPage'));

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
   PROTECTED WRAPPER
   ======================= */
interface ProtectedRouteWithLayoutProps {
    children: React.ReactNode;
    requiredFeature?: string;
    noPadding?: boolean;
}

const ProtectedRouteWithLayout: React.FC<ProtectedRouteWithLayoutProps> = ({
    children,
    requiredFeature,
    noPadding = false,
}) => (
    <ProtectedRoute requiredFeature={requiredFeature}>
        <AppLayout noPadding={noPadding}>
            <Suspense fallback={<PageLoader />}>{children}</Suspense>
        </AppLayout>
    </ProtectedRoute>
);

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

            {/* ================= Dashboard ================= */}
            <Route
                path="/dashboard"
                element={
                    <ProtectedRouteWithLayout>
                        <Suspense fallback={<PageLoader />}>
                            <DashboardPage />
                        </Suspense>
                    </ProtectedRouteWithLayout>
                }
            />

            {/* ================= My Workspace ================= */}
            <Route
                path="/profile"
                element={
                    <ProtectedRouteWithLayout>
                        <ProfilePage />
                    </ProtectedRouteWithLayout>
                }
            />

            <Route
                path="/my-roster"
                element={
                    <ProtectedRouteWithLayout>
                        <MyRosterPage />
                    </ProtectedRouteWithLayout>
                }
            />

            <Route
                path="/availabilities"
                element={
                    <ProtectedRouteWithLayout>
                        <AvailabilityPage />
                    </ProtectedRouteWithLayout>
                }
            />

            <Route
                path="/bids"
                element={
                    <ProtectedRouteWithLayout>
                        <EmployeeBidsPage />
                    </ProtectedRouteWithLayout>
                }
            />

            <Route
                path="/my-swaps"
                element={
                    <ProtectedRouteWithLayout>
                        <EmployeeSwapsPage />
                    </ProtectedRouteWithLayout>
                }
            />

            {/* ================= Employee Broadcasts ================= */}
            <Route
                path="/my-broadcasts"
                element={
                    <ProtectedRouteWithLayout requiredFeature="my-broadcasts">
                        <MyBroadcastsPage />
                    </ProtectedRouteWithLayout>
                }
            />

            {/* ================= Rostering ================= */}
            <Route
                path="/templates"
                element={
                    <ProtectedRouteWithLayout requiredFeature="templates">
                        <TemplatesPage />
                    </ProtectedRouteWithLayout>
                }
            />

            <Route
                path="/rosters"
                element={
                    <ProtectedRouteWithLayout requiredFeature="rosters" noPadding>
                        <RostersPlannerPage />
                    </ProtectedRouteWithLayout>
                }
            />

            <Route
                path="/labor-demand"
                element={
                    <ProtectedRouteWithLayout requiredFeature="rosters">
                        <LaborDemandForecastingPage />
                    </ProtectedRouteWithLayout>
                }
            />

            <Route
                path="/timesheet"
                element={
                    <ProtectedRouteWithLayout requiredFeature="timesheet-view">
                        <TimesheetPage />
                    </ProtectedRouteWithLayout>
                }
            />

            <Route
                path="/timesheet/audit/:timesheetId"
                element={
                    <ProtectedRouteWithLayout requiredFeature="timesheet-view">
                        <AuditTrailPage />
                    </ProtectedRouteWithLayout>
                }
            />

            {/* ================= Audit Dashboard ================= */}
            <Route
                path="/audit"
                element={
                    <ProtectedRouteWithLayout requiredFeature="rosters">
                        <AuditDashboardPage />
                    </ProtectedRouteWithLayout>
                }
            />

            <Route
                path="/audit/:shiftId"
                element={
                    <ProtectedRouteWithLayout requiredFeature="rosters">
                        <ShiftDetailView />
                    </ProtectedRouteWithLayout>
                }
            />

            {/* ================= Management ================= */}
            <Route
                path="/management/bids"
                element={
                    <ProtectedRouteWithLayout requiredFeature="management">
                        <ManagerBidsPage />
                    </ProtectedRouteWithLayout>
                }
            />

            <Route
                path="/management/swaps"
                element={
                    <ProtectedRouteWithLayout requiredFeature="management">
                        <ManagerSwapsPage />
                    </ProtectedRouteWithLayout>
                }
            />

            {/* ================= Manager Broadcast ================= */}
            <Route
                path="/broadcast"
                element={
                    <ProtectedRouteWithLayout requiredFeature="broadcast">
                        <BroadcastManagerPage />
                    </ProtectedRouteWithLayout>
                }
            />

            {/* ================= Admin / Analytics ================= */}
            <Route
                path="/insights"
                element={
                    <ProtectedRouteWithLayout requiredFeature="insights">
                        <InsightsPage />
                    </ProtectedRouteWithLayout>
                }
            />

            <Route
                path="/insights/:metricId"
                element={
                    <ProtectedRouteWithLayout requiredFeature="insights">
                        <AnalysisPage />
                    </ProtectedRouteWithLayout>
                }
            />

            <Route
                path="/contracts"
                element={
                    <ProtectedRouteWithLayout requiredFeature="configurations">
                        <ContractsPage />
                    </ProtectedRouteWithLayout>
                }
            />

            <Route
                path="/users"
                element={
                    <ProtectedRouteWithLayout requiredFeature="users">
                        <UsersPage />
                    </ProtectedRouteWithLayout>
                }
            />

            {/* ================= Utility ================= */}
            <Route
                path="/search"
                element={
                    <ProtectedRouteWithLayout>
                        <SearchPage />
                    </ProtectedRouteWithLayout>
                }
            />

            {/* ================= Catch All ================= */}
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
};

export default AppRouter;
