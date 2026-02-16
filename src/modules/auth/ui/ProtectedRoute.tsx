// src/components/ProtectedRoute.tsx
// FIXED VERSION - Works with updated AuthContext

import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/platform/auth/useAuth';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: 'admin' | 'manager' | 'teamlead';
  requiredFeature?: string;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requiredRole,
  requiredFeature,
}) => {
  const { user, isAuthenticated, isLoading, hasPermission, hasRole, hasActiveContracts } =
    useAuth();
  const location = useLocation();

  // Show loading spinner while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 text-primary animate-spin" />
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated || !user) {
    console.log('[ProtectedRoute] Not authenticated, redirecting to login');
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Redirect to pending-access if no active contracts
  if (!hasActiveContracts) {
    console.log('[ProtectedRoute] No active contracts, redirecting to pending-access');
    return <Navigate to="/pending-access" replace />;
  }

  // Check role requirement
  if (requiredRole) {
    const allowedRoles = ['admin', requiredRole];
    if (!hasRole(allowedRoles as any)) {
      console.log(
        '[ProtectedRoute] Role not allowed:',
        user.systemRole,
        'Required:',
        requiredRole
      );
      return <Navigate to="/unauthorized" replace />;
    }
  }

  // Check feature permission
  if (requiredFeature && !hasPermission(requiredFeature)) {
    console.log('[ProtectedRoute] No permission for feature:', requiredFeature);
    return <Navigate to="/unauthorized" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
