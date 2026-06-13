import { Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useIsSuperAdmin } from '@/hooks/useIsSuperAdmin';
import { useToast } from '@/hooks/use-toast';

/**
 * Route guard for Super-Admin-only modules (Payroll, Appraisals, Payroll Settings).
 * Renders nothing while the role check is in-flight, then either children or a
 * redirect to home with an "Access denied" toast.
 */
export function SuperAdminRoute({ children, label }: { children: React.ReactNode; label?: string }) {
  const { isAuthenticated } = useAuth();
  const { isAdmin, loading } = useIsSuperAdmin();
  const location = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    if (!loading && isAuthenticated && !isAdmin) {
      toast({
        title: 'Access denied',
        description: `${label ?? 'This module'} is restricted to Super Admin.`,
        variant: 'destructive',
      });
    }
  }, [loading, isAuthenticated, isAdmin, label, toast]);

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (loading) return null;
  if (!isAdmin) {
    return <Navigate to="/" replace state={{ accessDenied: true, deniedPath: location.pathname }} />;
  }
  return <>{children}</>;
}