import React, { createContext, useContext, useMemo } from 'react';
import { useTimesheets, useTimesheetByDate } from './timesheet.hooks';
import { Timesheet, TimesheetStatus } from '../model/timesheet.types';

interface TimesheetContextValue {
    timesheets: Timesheet[];
    loading: boolean;
    refresh: () => Promise<void>;
    updateStatus: (id: string | number, newStatus: TimesheetStatus, performedBy: string, reason?: string) => Promise<void>;
}

const TimesheetContext = createContext<TimesheetContextValue | undefined>(undefined);

export const TimesheetProvider: React.FC<{ children: React.ReactNode; startDate?: string; endDate?: string }> = ({
    children,
    startDate,
    endDate
}) => {
    const { timesheets, loading, refresh, updateStatus } = useTimesheets(startDate, endDate);

    const value = useMemo(() => ({
        timesheets,
        loading,
        refresh,
        updateStatus,
    }), [timesheets, loading, refresh, updateStatus]);

    return (
        <TimesheetContext.Provider value={value}>
            {children}
        </TimesheetContext.Provider>
    );
};

export const useTimesheetContext = () => {
    const context = useContext(TimesheetContext);
    if (!context) {
        throw new Error('useTimesheetContext must be used within a TimesheetProvider');
    }
    return context;
};
