// ============================================================
// BROADCAST HOOKS — TanStack Query migration (Phase 5, P5-2)
// Location: src/modules/broadcasts/state/useBroadcasts.ts
//
// All hooks are drop-in replacements for the original useState/
// useEffect-based hooks. Return shapes are identical.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useAuth } from '@/platform/auth/useAuth';
import {
    broadcastGroupQueries,
    broadcastGroupCommands,
    broadcastChannelCommands,
    broadcastQueries,
    broadcastCommands,
    groupParticipantCommands,
    groupParticipantQueries,
    broadcastNotificationCommands,
    broadcastNotificationQueries,
    broadcastRealtimeService,
} from '../api/broadcasts.api';
import { broadcastKeys } from '../api/queryKeys';
import type {
    BroadcastGroupWithStats,
    BroadcastGroupFull,
    EmployeeBroadcastGroup,
    BroadcastChannel,
    BroadcastWithDetails,
    BroadcastNotification,
    CreateBroadcastGroupRequest,
    CreateBroadcastChannelRequest,
    CreateBroadcastRequest,
    BroadcastFilters,
    BroadcastParticipantRole,
} from '../model/broadcast.types';

// ============================================================
// useBroadcastGroups — Manager Dashboard
// ============================================================

interface UseBroadcastGroupsReturn {
    groups: BroadcastGroupWithStats[];
    isLoading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
    createGroup: (data: CreateBroadcastGroupRequest) => Promise<any>;
    updateGroup: (groupId: string, data: Partial<CreateBroadcastGroupRequest>) => Promise<void>;
    deleteGroup: (groupId: string) => Promise<void>;
}

export function useBroadcastGroups(
    filters?: { organizationId?: string; departmentId?: string; subDepartmentId?: string }
): UseBroadcastGroupsReturn {
    const { user } = useAuth();
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: broadcastKeys.groups.forManager(filters),
        queryFn: () => broadcastGroupQueries.getAll(filters),
        staleTime: 30_000,
    });

    const refetch = useCallback(async () => {
        await query.refetch();
    }, [query]);

    const createGroupMutation = useMutation({
        mutationFn: (data: CreateBroadcastGroupRequest) => {
            if (!user?.id) throw new Error('User not authenticated');
            return broadcastGroupCommands.create(data, user.id);
        },
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: broadcastKeys.groups.all });
            toast({
                title: 'Group Created',
                description: `"${variables.name}" has been created.`,
            });
        },
        onError: () => {
            toast({
                title: 'Error',
                description: 'Failed to create group',
                variant: 'destructive',
            });
        },
    });

    const updateGroupMutation = useMutation({
        mutationFn: ({ groupId, data }: { groupId: string; data: Partial<CreateBroadcastGroupRequest> }) =>
            broadcastGroupCommands.update(groupId, data),
        onSuccess: (_data, { groupId }) => {
            queryClient.invalidateQueries({ queryKey: broadcastKeys.group.detail(groupId) });
            queryClient.invalidateQueries({ queryKey: broadcastKeys.groups.all });
            toast({ title: 'Group Updated' });
        },
        onError: () => {
            toast({
                title: 'Error',
                description: 'Failed to update group',
                variant: 'destructive',
            });
        },
    });

    const deleteGroupMutation = useMutation({
        mutationFn: (groupId: string) => broadcastGroupCommands.delete(groupId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: broadcastKeys.groups.all });
            toast({ title: 'Group Deleted' });
        },
        onError: () => {
            toast({
                title: 'Error',
                description: 'Failed to delete group',
                variant: 'destructive',
            });
        },
    });

    const createGroup = useCallback(
        async (data: CreateBroadcastGroupRequest) => {
            return createGroupMutation.mutateAsync(data);
        },
        [createGroupMutation]
    );

    const updateGroup = useCallback(
        async (groupId: string, data: Partial<CreateBroadcastGroupRequest>) => {
            await updateGroupMutation.mutateAsync({ groupId, data });
        },
        [updateGroupMutation]
    );

    const deleteGroup = useCallback(
        async (groupId: string) => {
            await deleteGroupMutation.mutateAsync(groupId);
        },
        [deleteGroupMutation]
    );

    return {
        groups: query.data ?? [],
        isLoading: query.isPending || query.isLoading,
        error: query.error as Error | null,
        refetch,
        createGroup,
        updateGroup,
        deleteGroup,
    };
}

// ============================================================
// useEmployeeBroadcastGroups — Employee View
// ============================================================

interface UseEmployeeBroadcastGroupsReturn {
    groups: EmployeeBroadcastGroup[];
    isLoading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
}

export function useEmployeeBroadcastGroups(
    scope?: { organizationId?: string; departmentId?: string; subDepartmentId?: string }
): UseEmployeeBroadcastGroupsReturn {
    const { user } = useAuth();

    const query = useQuery({
        queryKey: broadcastKeys.groups.forEmployee(scope),
        queryFn: () => broadcastGroupQueries.getForEmployee(user!.id, scope),
        enabled: !!user?.id,
        staleTime: 30_000,
    });

    const refetch = useCallback(async () => {
        await query.refetch();
    }, [query]);

    return {
        groups: query.data ?? [],
        isLoading: query.isPending || query.isLoading,
        error: query.error as Error | null,
        refetch,
    };
}

// ============================================================
// useBroadcastGroup — Single Group with Full Details
// ============================================================

interface UseBroadcastGroupReturn {
    group: BroadcastGroupFull | null;
    isLoading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
    userRole: BroadcastParticipantRole | null;
    canBroadcast: boolean;
    canManage: boolean;

    // Channel operations
    createChannel: (data: Omit<CreateBroadcastChannelRequest, 'groupId'>) => Promise<BroadcastChannel>;
    deleteChannel: (channelId: string) => Promise<void>;

    // Participant operations
    addParticipant: (employeeId: string, role?: BroadcastParticipantRole) => Promise<void>;
    removeParticipant: (employeeId: string) => Promise<void>;
    updateParticipantRole: (employeeId: string, role: BroadcastParticipantRole) => Promise<void>;
}

export function useBroadcastGroup(groupId: string | null): UseBroadcastGroupReturn {
    const { user } = useAuth();
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // Fetch full group details
    const groupQuery = useQuery({
        queryKey: broadcastKeys.group.detail(groupId ?? ''),
        queryFn: () => broadcastGroupQueries.getById(groupId!),
        enabled: !!groupId,
        staleTime: 30_000,
    });

    // Fetch the current user's role in this group
    const userRoleQuery = useQuery({
        queryKey: [...broadcastKeys.group.detail(groupId ?? ''), 'userRole', user?.id ?? ''],
        queryFn: () => groupParticipantQueries.getUserRole(groupId!, user!.id),
        enabled: !!groupId && !!user?.id,
        staleTime: 60_000,
    });

    const refetch = useCallback(async () => {
        await groupQuery.refetch();
        await userRoleQuery.refetch();
    }, [groupQuery, userRoleQuery]);

    const userRole = userRoleQuery.data ?? null;

    const canBroadcast =
        userRole === 'admin' ||
        userRole === 'broadcaster' ||
        user?.role === 'admin' ||
        user?.role === 'manager';
    const canManage =
        userRole === 'admin' || user?.role === 'admin' || user?.role === 'manager';

    // Channel mutations
    const createChannelMutation = useMutation({
        mutationFn: (data: Omit<CreateBroadcastChannelRequest, 'groupId'>) => {
            if (!groupId) throw new Error('No group selected');
            return broadcastChannelCommands.create({ ...data, groupId });
        },
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: broadcastKeys.group.detail(groupId ?? '') });
            queryClient.invalidateQueries({ queryKey: broadcastKeys.channels.byGroup(groupId ?? '') });
            toast({
                title: 'Channel Created',
                description: `"${variables.name}" has been created.`,
            });
        },
    });

    const deleteChannelMutation = useMutation({
        mutationFn: (channelId: string) => broadcastChannelCommands.delete(channelId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: broadcastKeys.group.detail(groupId ?? '') });
            queryClient.invalidateQueries({ queryKey: broadcastKeys.channels.byGroup(groupId ?? '') });
            toast({ title: 'Channel Deleted' });
        },
    });

    // Participant mutations
    const addParticipantMutation = useMutation({
        mutationFn: ({ employeeId, role }: { employeeId: string; role?: BroadcastParticipantRole }) => {
            if (!groupId) throw new Error('No group selected');
            return groupParticipantCommands.add({ groupId, employeeId, role });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: broadcastKeys.group.detail(groupId ?? '') });
            toast({ title: 'Participant Added' });
        },
    });

    const removeParticipantMutation = useMutation({
        mutationFn: (employeeId: string) => {
            if (!groupId) throw new Error('No group selected');
            return groupParticipantCommands.remove(groupId, employeeId);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: broadcastKeys.group.detail(groupId ?? '') });
            toast({ title: 'Participant Removed' });
        },
    });

    const updateParticipantRoleMutation = useMutation({
        mutationFn: ({ employeeId, role }: { employeeId: string; role: BroadcastParticipantRole }) => {
            if (!groupId) throw new Error('No group selected');
            return groupParticipantCommands.updateRole(groupId, employeeId, role);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: broadcastKeys.group.detail(groupId ?? '') });
            toast({ title: 'Role Updated' });
        },
    });

    const createChannel = useCallback(
        async (data: Omit<CreateBroadcastChannelRequest, 'groupId'>) => {
            return createChannelMutation.mutateAsync(data);
        },
        [createChannelMutation]
    );

    const deleteChannel = useCallback(
        async (channelId: string) => {
            await deleteChannelMutation.mutateAsync(channelId);
        },
        [deleteChannelMutation]
    );

    const addParticipant = useCallback(
        async (employeeId: string, role?: BroadcastParticipantRole) => {
            await addParticipantMutation.mutateAsync({ employeeId, role });
        },
        [addParticipantMutation]
    );

    const removeParticipant = useCallback(
        async (employeeId: string) => {
            await removeParticipantMutation.mutateAsync(employeeId);
        },
        [removeParticipantMutation]
    );

    const updateParticipantRole = useCallback(
        async (employeeId: string, role: BroadcastParticipantRole) => {
            await updateParticipantRoleMutation.mutateAsync({ employeeId, role });
        },
        [updateParticipantRoleMutation]
    );

    return {
        group: groupQuery.data ?? null,
        isLoading: groupQuery.isPending || groupQuery.isLoading,
        error: groupQuery.error as Error | null,
        refetch,
        userRole,
        canBroadcast,
        canManage,
        createChannel,
        deleteChannel,
        addParticipant,
        removeParticipant,
        updateParticipantRole,
    };
}

// ============================================================
// useBroadcasts — Broadcasts for a Channel (Manager)
// ============================================================

interface UseBroadcastsReturn {
    broadcasts: BroadcastWithDetails[];
    isLoading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;

    // Filters
    filters: BroadcastFilters;
    setFilters: (filters: BroadcastFilters) => void;

    // Pagination
    page: number;
    totalPages: number;
    setPage: (page: number) => void;

    // Actions
    createBroadcast: (data: Omit<CreateBroadcastRequest, 'channelId'>) => Promise<void>;
    deleteBroadcast: (broadcastId: string) => Promise<void>;
    togglePin: (broadcastId: string, isPinned: boolean) => Promise<void>;

    // Computed
    pinnedBroadcasts: BroadcastWithDetails[];
    activeBroadcasts: BroadcastWithDetails[];
}

export function useBroadcasts(channelId: string | null): UseBroadcastsReturn {
    const { user } = useAuth();
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [filters, setFilters] = useState<BroadcastFilters>({});
    const [page, setPage] = useState(1);

    // Main broadcasts query
    const broadcastsQuery = useQuery({
        queryKey: [...broadcastKeys.broadcasts.byChannel(channelId ?? ''), filters, page],
        queryFn: () =>
            broadcastQueries.getByChannelId(channelId!, filters, { page, pageSize: 20 }),
        enabled: !!channelId,
        staleTime: 30_000,
    });

    const refetch = useCallback(async () => {
        await broadcastsQuery.refetch();
    }, [broadcastsQuery]);

    // Real-time subscription — invalidates query cache on any change
    useEffect(() => {
        if (!channelId) return;

        const subscription = broadcastRealtimeService.subscribeToChannel(
            channelId,
            () => {
                // INSERT — full invalidation so new broadcast appears
                queryClient.invalidateQueries({
                    queryKey: broadcastKeys.broadcasts.byChannel(channelId),
                });
            },
            () => {
                // UPDATE — invalidate to get fresh data with all joined fields
                queryClient.invalidateQueries({
                    queryKey: broadcastKeys.broadcasts.byChannel(channelId),
                });
            },
            () => {
                // DELETE — invalidate
                queryClient.invalidateQueries({
                    queryKey: broadcastKeys.broadcasts.byChannel(channelId),
                });
            }
        );

        return () => {
            void broadcastRealtimeService.unsubscribe(subscription);
        };
    }, [channelId, queryClient]);

    // Mutations
    const createBroadcastMutation = useMutation({
        mutationFn: (data: Omit<CreateBroadcastRequest, 'channelId'>) => {
            if (!user?.id) throw new Error('User not authenticated');
            if (!channelId) throw new Error('No channel selected');
            return broadcastCommands.create({ ...data, channelId }, user.id);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: broadcastKeys.broadcasts.byChannel(channelId ?? ''),
            });
            queryClient.invalidateQueries({ queryKey: broadcastKeys.analytics.all });
            toast({
                title: 'Broadcast Sent',
                description: 'Your message has been delivered.',
            });
        },
        onError: () => {
            toast({
                title: 'Error',
                description: 'Failed to send broadcast',
                variant: 'destructive',
            });
        },
    });

    const deleteBroadcastMutation = useMutation({
        mutationFn: (broadcastId: string) => broadcastCommands.delete(broadcastId),
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: broadcastKeys.broadcasts.byChannel(channelId ?? ''),
            });
            queryClient.invalidateQueries({ queryKey: broadcastKeys.analytics.all });
            toast({ title: 'Broadcast Deleted' });
        },
        onError: () => {
            toast({
                title: 'Error',
                description: 'Failed to delete broadcast',
                variant: 'destructive',
            });
        },
    });

    const togglePinMutation = useMutation({
        mutationFn: ({ broadcastId, isPinned }: { broadcastId: string; isPinned: boolean }) =>
            broadcastCommands.togglePin(broadcastId, isPinned),
        onSuccess: (_data, { isPinned }) => {
            queryClient.invalidateQueries({
                queryKey: broadcastKeys.broadcasts.byChannel(channelId ?? ''),
            });
            toast({ title: isPinned ? 'Broadcast Pinned' : 'Broadcast Unpinned' });
        },
        onError: () => {
            toast({
                title: 'Error',
                description: 'Failed to update pin status',
                variant: 'destructive',
            });
        },
    });

    const createBroadcast = useCallback(
        async (data: Omit<CreateBroadcastRequest, 'channelId'>) => {
            await createBroadcastMutation.mutateAsync(data);
        },
        [createBroadcastMutation]
    );

    const deleteBroadcast = useCallback(
        async (broadcastId: string) => {
            await deleteBroadcastMutation.mutateAsync(broadcastId);
        },
        [deleteBroadcastMutation]
    );

    const togglePin = useCallback(
        async (broadcastId: string, isPinned: boolean) => {
            await togglePinMutation.mutateAsync({ broadcastId, isPinned });
        },
        [togglePinMutation]
    );

    const broadcasts = broadcastsQuery.data?.data ?? [];
    const totalPages = broadcastsQuery.data?.totalPages ?? 1;

    const pinnedBroadcasts = useMemo(
        () => broadcasts.filter((b) => b.isPinned),
        [broadcasts]
    );

    const activeBroadcasts = useMemo(
        () => broadcasts.filter((b) => !b.isPinned),
        [broadcasts]
    );

    return {
        broadcasts,
        isLoading: broadcastsQuery.isPending || broadcastsQuery.isLoading,
        error: broadcastsQuery.error as Error | null,
        refetch,
        filters,
        setFilters,
        page,
        totalPages,
        setPage,
        createBroadcast,
        deleteBroadcast,
        togglePin,
        pinnedBroadcasts,
        activeBroadcasts,
    };
}

// ============================================================
// useEmployeeBroadcasts — Broadcasts for Employee View (paginated)
// ============================================================

interface UseEmployeeBroadcastsReturn {
    broadcasts: BroadcastWithDetails[];
    isLoading: boolean;
    isLoadingMore: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
    loadMore: () => void;
    hasMore: boolean;
}

export function useEmployeeBroadcasts(channelId: string | null): UseEmployeeBroadcastsReturn {
    const { user } = useAuth();
    const [page, setPage] = useState(1);
    const [accumulatedBroadcasts, setAccumulatedBroadcasts] = useState<BroadcastWithDetails[]>([]);
    const [totalPages, setTotalPages] = useState(1);
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    // Reset accumulator when channel changes
    useEffect(() => {
        setAccumulatedBroadcasts([]);
        setPage(1);
        setTotalPages(1);
    }, [channelId]);

    const query = useQuery({
        queryKey: [
            ...broadcastKeys.broadcasts.byChannel(channelId ?? ''),
            'employee',
            user?.id ?? '',
            page,
        ],
        queryFn: () =>
            broadcastQueries.getForEmployee(channelId!, user!.id, {
                page,
                pageSize: 20,
            }),
        enabled: !!channelId && !!user?.id,
        staleTime: 30_000,
    });

    // Merge pages into accumulated list as data arrives
    useEffect(() => {
        if (!query.data) return;

        setTotalPages(query.data.totalPages);

        if (page === 1) {
            setAccumulatedBroadcasts(query.data.data);
        } else {
            setAccumulatedBroadcasts((prev) => [...prev, ...query.data!.data]);
        }

        setIsLoadingMore(false);
    }, [query.data, page]);

    const refetch = useCallback(async () => {
        setPage(1);
        setAccumulatedBroadcasts([]);
        await query.refetch();
    }, [query]);

    const loadMore = useCallback(() => {
        if (!isLoadingMore && page < totalPages) {
            setIsLoadingMore(true);
            setPage((prev) => prev + 1);
        }
    }, [isLoadingMore, page, totalPages]);

    return {
        broadcasts: accumulatedBroadcasts,
        isLoading: query.isPending || query.isLoading,
        isLoadingMore,
        error: query.error as Error | null,
        refetch,
        loadMore,
        hasMore: page < totalPages,
    };
}

// ============================================================
// useBroadcastNotifications — User Notifications
// ============================================================

interface UseBroadcastNotificationsReturn {
    notifications: BroadcastNotification[];
    unreadCount: number;
    isLoading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
    markAsRead: (notificationId: string) => Promise<void>;
    markAllAsRead: () => Promise<void>;
}

export function useBroadcastNotifications(): UseBroadcastNotificationsReturn {
    const { user } = useAuth();
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: broadcastKeys.notifications.forUser(user?.id ?? ''),
        queryFn: () => broadcastNotificationQueries.getForUser(user!.id),
        enabled: !!user?.id,
        staleTime: 30_000,
    });

    const refetch = useCallback(async () => {
        await query.refetch();
    }, [query]);

    // Real-time: new notifications arrive via INSERT — prepend to cache and toast
    useEffect(() => {
        if (!user?.id) return;

        const subscription = broadcastRealtimeService.subscribeToNotifications(
            user.id,
            (notification) => {
                // Surgically prepend the new notification to the cache
                queryClient.setQueryData<BroadcastNotification[]>(
                    broadcastKeys.notifications.forUser(user.id),
                    (old) => (old ? [notification, ...old] : [notification])
                );
                toast({
                    title: notification.subject,
                    description: `New broadcast from ${notification.authorName} in ${notification.groupName}`,
                });
            }
        );

        return () => {
            void broadcastRealtimeService.unsubscribe(subscription);
        };
    }, [user?.id, queryClient, toast]);

    // Mark-as-read mutation — optimistic update, then invalidate to confirm
    const markAsReadMutation = useMutation({
        mutationFn: (notificationId: string) =>
            broadcastNotificationCommands.markAsRead(notificationId),
        onMutate: async (notificationId) => {
            await queryClient.cancelQueries({
                queryKey: broadcastKeys.notifications.forUser(user?.id ?? ''),
            });
            const previous = queryClient.getQueryData<BroadcastNotification[]>(
                broadcastKeys.notifications.forUser(user?.id ?? '')
            );
            queryClient.setQueryData<BroadcastNotification[]>(
                broadcastKeys.notifications.forUser(user?.id ?? ''),
                (old) =>
                    old?.map((n) => (n.id === notificationId ? { ...n, isRead: true } : n))
            );
            return { previous };
        },
        onError: (_err, _id, context) => {
            if (context?.previous) {
                queryClient.setQueryData(
                    broadcastKeys.notifications.forUser(user?.id ?? ''),
                    context.previous
                );
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({
                queryKey: broadcastKeys.notifications.forUser(user?.id ?? ''),
            });
        },
    });

    // Mark-all-as-read mutation — optimistic patch, then invalidate
    const markAllAsReadMutation = useMutation({
        mutationFn: () => {
            if (!user?.id) return Promise.resolve();
            return broadcastNotificationCommands.markAllAsRead(user.id);
        },
        onMutate: async () => {
            await queryClient.cancelQueries({
                queryKey: broadcastKeys.notifications.forUser(user?.id ?? ''),
            });
            const previous = queryClient.getQueryData<BroadcastNotification[]>(
                broadcastKeys.notifications.forUser(user?.id ?? '')
            );
            queryClient.setQueryData<BroadcastNotification[]>(
                broadcastKeys.notifications.forUser(user?.id ?? ''),
                (old) => old?.map((n) => ({ ...n, isRead: true }))
            );
            return { previous };
        },
        onError: (_err, _vars, context) => {
            if (context?.previous) {
                queryClient.setQueryData(
                    broadcastKeys.notifications.forUser(user?.id ?? ''),
                    context.previous
                );
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({
                queryKey: broadcastKeys.notifications.forUser(user?.id ?? ''),
            });
        },
    });

    const markAsRead = useCallback(
        async (notificationId: string) => {
            await markAsReadMutation.mutateAsync(notificationId);
        },
        [markAsReadMutation]
    );

    const markAllAsRead = useCallback(async () => {
        await markAllAsReadMutation.mutateAsync();
    }, [markAllAsReadMutation]);

    const notifications = query.data ?? [];

    const unreadCount = useMemo(
        () => notifications.filter((n) => !n.isRead).length,
        [notifications]
    );

    return {
        notifications,
        unreadCount,
        isLoading: query.isPending || query.isLoading,
        error: query.error as Error | null,
        refetch,
        markAsRead,
        markAllAsRead,
    };
}
