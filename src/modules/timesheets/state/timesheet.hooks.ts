import { useState, useCallback, useEffect } from 'react';
import { Timesheet, TimesheetStatus, TimesheetRow } from '../model/timesheet.types';
import { TimesheetAuditEntry } from '../model/audit.types';
import { timesheetReadApi } from '../api/timesheets.read.api';
import { timesheetWriteApi } from '../api/timesheets.write.api';
import { auditsApi } from '../api/audits.api';
import { useToast } from '@/modules/core/hooks/use-toast';

export const useTimesheets = (startDate?: string, endDate?: string) => {
    const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const { toast } = useToast();

    const loadTimesheets = useCallback(async () => {
        setLoading(true);
        try {
            let data: Timesheet[];
            if (startDate && endDate) {
                data = await timesheetReadApi.getTimesheetsByDateRange(startDate, endDate);
            } else {
                data = await timesheetReadApi.getAllTimesheets();
            }
            setTimesheets(data);
            setError(null);
        } catch (err) {
            setError(err as Error);
            toast({
                title: 'Error loading timesheets',
                description: (err as Error).message,
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    }, [startDate, endDate, toast]);

    useEffect(() => {
        loadTimesheets();
    }, [loadTimesheets]);

    const updateStatus = useCallback(async (
        id: string | number,
        newStatus: TimesheetStatus,
        performedBy: string,
        reason?: string
    ) => {
        try {
            const updated = await timesheetWriteApi.updateTimesheetStatus(id, newStatus, performedBy, reason);
            if (updated) {
                setTimesheets(prev => prev.map(ts => ts.id === id ? updated : ts));
                toast({
                    title: 'Status Updated',
                    description: `Timesheet is now ${newStatus}`,
                });
            }
        } catch (err) {
            toast({
                title: 'Failed to update status',
                description: (err as Error).message,
                variant: 'destructive',
            });
            throw err;
        }
    }, [toast]);

    return {
        timesheets,
        loading,
        error,
        refresh: loadTimesheets,
        updateStatus,
    };
};

export const useTimesheetByDate = (date: string) => {
    const [timesheet, setTimesheet] = useState<Timesheet | null>(null);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await timesheetReadApi.getTimesheetByDate(date);
            setTimesheet(data);
        } catch (err) {
            toast({
                title: 'Error loading timesheet',
                description: (err as Error).message,
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    }, [date, toast]);

    useEffect(() => {
        load();
    }, [load]);

    const updateShift = useCallback(async (
        groupId: string | number,
        subGroupId: string | number,
        shiftId: string | number,
        status: any
    ) => {
        try {
            const updated = await timesheetWriteApi.updateShiftStatus(date, groupId, subGroupId, shiftId, status);
            if (updated) {
                setTimesheet(updated);
            }
        } catch (err) {
            toast({
                title: 'Update failed',
                description: (err as Error).message,
                variant: 'destructive',
            });
        }
    }, [date, toast]);

    return {
        timesheet,
        loading,
        updateShift,
        refresh: load,
    };
};

export const useTimesheetAudit = (timesheetId?: string | number) => {
    const [data, setData] = useState<TimesheetAuditEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const { toast } = useToast();

    const loadHistory = useCallback(async () => {
        if (!timesheetId) {
            setData([]);
            return;
        }

        setLoading(true);
        try {
            const history = await auditsApi.getAuditTrail(String(timesheetId));
            setData(history);
            setError(null);
        } catch (err) {
            setError(err as Error);
            toast({
                title: 'Error loading audit history',
                description: (err as Error).message,
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    }, [timesheetId, toast]);

    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    return {
        data,
        loading,
        error,
        refresh: loadHistory,
    };
};
