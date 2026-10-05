import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import { useToast } from '@/modules/core/hooks/use-toast';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import {
    currentQualifications,
    describeAppointmentError,
    type FirstAidAppointment,
    type FirstAidQualification,
} from '@/modules/users/domain/firstAidAppointment';

const appointmentsKey = (employeeId: string) => ['first_aid_appointments', employeeId] as const;

/**
 * An appointment changes what every shift of that person costs, without
 * touching any shift row — so the shift caches never notice on their own.
 * Refresh everything that prices a shift: roster lists, bucket summaries and
 * planner stats (all under shiftKeys.all), the planner prefetch, and payroll.
 */
async function invalidateCostViews(queryClient: QueryClient, employeeId: string) {
    await Promise.all([
        queryClient.invalidateQueries({ queryKey: appointmentsKey(employeeId) }),
        queryClient.invalidateQueries({ queryKey: shiftKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['roster-view-bff'] }),
        queryClient.invalidateQueries({ queryKey: ['gross_pay_period'] }),
    ]);
}

export const useFirstAidAppointments = (employeeId: string) =>
    useQuery({
        queryKey: appointmentsKey(employeeId),
        queryFn: async () => {
            const { data, error } = await supabase
                .from('first_aid_appointments')
                .select('*, appointer:profiles!first_aid_appointments_appointed_by_fkey(first_name, last_name)')
                .eq('employee_id', employeeId)
                .order('effective_from', { ascending: false });
            if (error) throw error;
            return (data ?? []) as FirstAidAppointment[];
        },
        enabled: !!employeeId,
    });

/** Organisations the employee holds an active contract in — where an appointment can live. */
export const useEmployeeOrganisations = (employeeId: string) =>
    useQuery({
        queryKey: ['first_aid_appointments', employeeId, 'organisations'],
        queryFn: async () => {
            const { data: contracts, error } = await supabase
                .from('user_contracts')
                .select('organization_id')
                .eq('user_id', employeeId)
                .eq('status', 'Active');
            if (error) throw error;
            const ids = [...new Set((contracts ?? []).map(c => c.organization_id).filter((id): id is string => !!id))];
            if (ids.length === 0) return [] as { id: string; name: string }[];
            const { data: orgs, error: orgErr } = await supabase.from('organizations').select('id, name').in('id', ids);
            if (orgErr) throw orgErr;
            return (orgs ?? []) as { id: string; name: string }[];
        },
        enabled: !!employeeId,
    });

/**
 * Asks the database the same question its RLS policy will ask, so the screen
 * only shows actions that will succeed. Also false for the caller's own record:
 * nobody may appoint themselves, as the appointment changes their pay.
 */
export const useCanManageFirstAid = (employeeId: string, organisationId: string | null) =>
    useQuery({
        queryKey: ['first_aid_appointments', employeeId, 'can_manage', organisationId],
        queryFn: async () => {
            const { data, error } = await supabase.rpc('can_manage_first_aid_appointment', {
                p_employee_id: employeeId,
                p_org_id: organisationId!,
            });
            if (error) throw error;
            return data === true;
        },
        enabled: !!employeeId && !!organisationId,
    });

/** First-aid licences and skills current on `onDate` (cl 28.2 qualification — warning only). */
export const useFirstAidQualifications = (employeeId: string, onDate: string) =>
    useQuery({
        queryKey: ['first_aid_appointments', employeeId, 'qualifications', onDate],
        queryFn: async (): Promise<FirstAidQualification[]> => {
            const [licences, skills] = await Promise.all([
                supabase
                    .from('employee_licenses')
                    .select('status, expiration_date, license:licenses(name)')
                    .eq('employee_id', employeeId),
                supabase
                    .from('employee_skills')
                    .select('status, expiration_date, skill:skills(name)')
                    .eq('employee_id', employeeId),
            ]);
            if (licences.error) throw licences.error;
            if (skills.error) throw skills.error;
            const nameOf = (rel: unknown) =>
                (Array.isArray(rel) ? rel[0] : rel as { name?: string } | null)?.name ?? null;
            return currentQualifications(
                (licences.data ?? []).map(r => ({ status: r.status, expiration_date: r.expiration_date, name: nameOf(r.license) })),
                (skills.data ?? []).map(r => ({ status: r.status, expiration_date: r.expiration_date, name: nameOf(r.skill) })),
                onDate,
            );
        },
        enabled: !!employeeId,
    });

export interface NewFirstAidAppointment {
    organization_id: string;
    employee_id: string;
    effective_from: string;
    effective_to: string | null;
    notes: string | null;
}

export const useCreateFirstAidAppointment = () => {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    return useMutation({
        mutationFn: async (input: NewFirstAidAppointment) => {
            const { data: auth } = await supabase.auth.getUser();
            const { error } = await supabase
                .from('first_aid_appointments')
                .insert({ ...input, appointed_by: auth.user?.id ?? null });
            if (error) throw error;
        },
        onSuccess: async (_, input) => {
            await invalidateCostViews(queryClient, input.employee_id);
            toast({ title: 'First aider appointed', description: 'Their shifts now include the first-aid allowance.' });
        },
        onError: (error: { code?: string; message?: string }) => {
            toast({ title: 'Could not appoint', description: describeAppointmentError(error), variant: 'destructive' });
        },
    });
};

export const useEndFirstAidAppointment = () => {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    return useMutation({
        mutationFn: async ({ id, effectiveTo }: { id: string; employeeId: string; effectiveTo: string }) => {
            const { error } = await supabase
                .from('first_aid_appointments')
                .update({ effective_to: effectiveTo })
                .eq('id', id);
            if (error) throw error;
        },
        onSuccess: async (_, { employeeId }) => {
            await invalidateCostViews(queryClient, employeeId);
            toast({ title: 'Appointment ended' });
        },
        onError: (error: { code?: string; message?: string }) => {
            toast({ title: 'Could not end the appointment', description: describeAppointmentError(error), variant: 'destructive' });
        },
    });
};

export const useDeleteFirstAidAppointment = () => {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    return useMutation({
        mutationFn: async ({ id }: { id: string; employeeId: string }) => {
            const { error } = await supabase.from('first_aid_appointments').delete().eq('id', id);
            if (error) throw error;
        },
        onSuccess: async (_, { employeeId }) => {
            await invalidateCostViews(queryClient, employeeId);
            toast({ title: 'Scheduled appointment removed' });
        },
        onError: (error: { code?: string; message?: string }) => {
            toast({ title: 'Could not remove the appointment', description: describeAppointmentError(error), variant: 'destructive' });
        },
    });
};
