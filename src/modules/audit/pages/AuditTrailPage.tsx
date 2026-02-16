
import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/modules/core/ui/primitives/card';
import { AuditTrail } from '@/modules/timesheets';
import { useTimesheetAudit } from '@/modules/timesheets';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { NavBreadcrumb } from '@/modules/core/ui/components/NavBreadcrumb';

const AuditTrailPage: React.FC = () => {
  const { timesheetId } = useParams<{ timesheetId: string }>();
  const navigate = useNavigate();
  const { theme } = useTheme();

  const parsedTimesheetId = timesheetId ? parseInt(timesheetId, 10) : undefined;

  const {
    data,
    loading,
    error,
    refresh
  } = useTimesheetAudit(parsedTimesheetId);

  const handleBack = () => {
    navigate('/timesheet');
  };

  // Get container background class based on theme
  const getContainerBgClass = () => {
    if (theme === 'light') {
      return 'bg-white border-gray-200';
    } else if (theme === 'dark') {
      return 'bg-gray-900 border-gray-700';
    } else {
      return 'bg-transparent backdrop-blur-md border-white/10';
    }
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-full min-h-screen">
      <div className={`rounded-lg shadow-xl border ${getContainerBgClass()}`}>
        {/* Header */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <Button
              variant="ghost"
              onClick={handleBack}
              className="flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Timesheet
            </Button>
          </div>

          <NavBreadcrumb />

          <div className="mt-4">
            <h1 className="text-2xl font-bold">Audit Trail</h1>
            <p className="text-muted-foreground mt-1">
              Complete history for Timesheet Entry #{timesheetId}
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {loading ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4"></div>
                <p>Loading audit history…</p>
              </CardContent>
            </Card>
          ) : error ? (
            <Card>
              <CardContent className="py-12">
                <div className="text-center">
                  <p className="text-red-500 mb-4">Couldn't load audit history.</p>
                  <Button onClick={refresh}>
                    Retry
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : data && data.length === 0 ? (
            <Card>
              <CardContent className="py-12">
                <div className="text-center">
                  <p className="text-muted-foreground">No history for this entry.</p>
                </div>
              </CardContent>
            </Card>
          ) : data ? (
            <Card>
              <CardHeader>
                <CardTitle>Event History</CardTitle>
              </CardHeader>
              <CardContent>
                <AuditTrail events={data} onClose={handleBack} showAsPage />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default AuditTrailPage;
