// ============================================================
// BROADCAST HOOKS - TAILORED FOR YOUR SETUP
// Location: src/modules/broadcasts/state/useBroadcasts.ts
//
// Uses user.id from your AuthContext
// ============================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useAuth } from '@/platform/auth/useAuth';
import {
    broadcastGroupService,
    broadcastChannelService,
    broadcastService,
    groupParticipantService,
    broadcastNotificationService,
    broadcastRealtimeService,
} from '../api/broadcasts.api';
import type {
    BroadcastGroupWithStats,
    BroadcastGroupFull,
    EmployeeBroadcastGroup,
    BroadcastChannel,
    BroadcastChannelWithStats,
    Broadcast,
    BroadcastWithDetails,
    BroadcastNotification,
    GroupParticipantWithDetails,
    BroadcastAckStats,
    BroadcastAcknowledgementWithDetails,
    CreateBroadcastGroupRequest,
    CreateBroadcastChannelRequest,
    CreateBroadcastRequest,
    BroadcastFilters,
    BroadcastParticipantRole,
} from '../model/broadcast.types';

// ============================================================
// useBroadcastGroups - For Manager Dashboard
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

export function useBroadcastGroups(filters?: { organizationId?: string; departmentId?: string; subDepartmentId?: string }): UseBroadcastGroupsReturn {
    const { user } = useAuth();
    const { toast } = useToast();
    const [groups, setGroups] = useState<BroadcastGroupWithStats[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const fetchGroups = useCallback(async () => {
        try {
            setIsLoading(true);
            setError(null);
            const data = await broadcastGroupService.getAll(filters);
            setGroups(data);
        } catch (err) {
            setError(err as Error);
            toast({
                title: 'Error',
                description: 'Failed to load broadcast groups',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    }, [toast, filters?.organizationId, filters?.departmentId, filters?.subDepartmentId]);

    useEffect(() => {
        fetchGroups();
    }, [fetchGroups]);

    const createGroup = useCallback(
        async (data: CreateBroadcastGroupRequest) => {
            // Use user.id for database references
            if (!user?.id) throw new Error('User not authenticated');

            try {
                const newGroup = await broadcastGroupService.create(data, user.id);
                toast({
                    title: 'Group Created',
                    description: `"${data.name}" has been created.`,
                });
                await fetchGroups();
                return newGroup;
            } catch (err) {
                toast({
                    title: 'Error',
                    description: 'Failed to create group',
                    variant: 'destructive',
                });
                throw err;
            }
        },
        [user, toast, fetchGroups]
    );

    const updateGroup = useCallback(
        async (groupId: string, data: Partial<CreateBroadcastGroupRequest>) => {
            try {
                await broadcastGroupService.update(groupId, data);
                setGroups((prev) =>
                    prev.map((g) => (g.id === groupId ? { ...g, ...data } : g))
                );
                toast({ title: 'Group Updated' });
            } catch (err) {
                toast({
                    title: 'Error',
                    description: 'Failed to update group',
                    variant: 'destructive',
                });
                throw err;
            }
        },
        [toast]
    );

    const deleteGroup = useCallback(
        async (groupId: string) => {
            try {
                await broadcastGroupService.delete(groupId);
                setGroups((prev) => prev.filter((g) => g.id !== groupId));
                toast({ title: 'Group Deleted' });
            } catch (err) {
                toast({
                    title: 'Error',
                    description: 'Failed to delete group',
                    variant: 'destructive',
                });
                throw err;
            }
        },
        [toast]
    );

    return {
        groups,
        isLoading,
        error,
        refetch: fetchGroups,
        createGroup,
        updateGroup,
        deleteGroup,
    };
}

// ============================================================
// useEmployeeBroadcastGroups - For Employee View
// ============================================================

interface UseEmployeeBroadcastGroupsReturn {
    groups: EmployeeBroadcastGroup[];
    isLoading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
}

export function useEmployeeBroadcastGroups(): UseEmployeeBroadcastGroupsReturn {
    const { user } = useAuth();
    const { toast } = useToast();
    const [groups, setGroups] = useState<EmployeeBroadcastGroup[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const fetchGroups = useCallback(async () => {
        // Use user.id for queries
        if (!user?.id) {
            setIsLoading(false);
            return;
        }

        try {
            setIsLoading(true);
            setError(null);
            const data = await broadcastGroupService.getForEmployee(user.id);
            setGroups(data);
        } catch (err) {
            setError(err as Error);
            toast({
                title: 'Error',
                description: 'Failed to load broadcast groups',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    }, [user?.id, toast]);

    useEffect(() => {
        fetchGroups();
    }, [fetchGroups]);

    // unread/ack counts removed

    return {
        groups,
        isLoading,
        error,
        refetch: fetchGroups,
    };
}

// ============================================================
// useBroadcastGroup - Single Group with Full Details
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
    createChannel: (
        data: Omit<CreateBroadcastChannelRequest, 'groupId'>
    ) => Promise<BroadcastChannel>;
    deleteChannel: (channelId: string) => Promise<void>;

    // Participant operations
    addParticipant: (
        employeeId: string,
        role?: BroadcastParticipantRole
    ) => Promise<void>;
    removeParticipant: (employeeId: string) => Promise<void>;
    updateParticipantRole: (
        employeeId: string,
        role: BroadcastParticipantRole
    ) => Promise<void>;
}

export function useBroadcastGroup(
    groupId: string | null
): UseBroadcastGroupReturn {
    const { user } = useAuth();
    const { toast } = useToast();
    const [group, setGroup] = useState<BroadcastGroupFull | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [userRole, setUserRole] = useState<BroadcastParticipantRole | null>(
        null
    );

    const fetchGroup = useCallback(async () => {
        if (!groupId) {
            setGroup(null);
            setIsLoading(false);
            return;
        }

        try {
            setIsLoading(true);
            setError(null);
            const data = await broadcastGroupService.getById(groupId);
            setGroup(data);

            // Get user's role using user.id
            if (user?.id) {
                const role = await groupParticipantService.getUserRole(
                    groupId,
                    user.id
                );
                setUserRole(role);
            }
        } catch (err) {
            setError(err as Error);
            toast({
                title: 'Error',
                description: 'Failed to load group details',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    }, [groupId, user?.id, toast]);

    useEffect(() => {
        fetchGroup();
    }, [fetchGroup]);

    // Also consider app-level role for permissions
    const canBroadcast =
        userRole === 'admin' ||
        userRole === 'broadcaster' ||
        user?.role === 'admin' ||
        user?.role === 'manager';
    const canManage =
        userRole === 'admin' || user?.role === 'admin' || user?.role === 'manager';

    // Channel operations
    const createChannel = useCallback(
        async (data: Omit<CreateBroadcastChannelRequest, 'groupId'>) => {
            if (!groupId) throw new Error('No group selected');
            const channel = await broadcastChannelService.create({
                ...data,
                groupId,
            });
            await fetchGroup();
            toast({
                title: 'Channel Created',
                description: `"${data.name}" has been created.`,
            });
            return channel;
        },
        [groupId, fetchGroup, toast]
    );

    const deleteChannel = useCallback(
        async (channelId: string) => {
            await broadcastChannelService.delete(channelId);
            await fetchGroup();
            toast({ title: 'Channel Deleted' });
        },
        [fetchGroup, toast]
    );

    // Participant operations
    const addParticipant = useCallback(
        async (employeeId: string, role?: BroadcastParticipantRole) => {
            if (!groupId) throw new Error('No group selected');
            await groupParticipantService.add({ groupId, employeeId, role });
            await fetchGroup();
            toast({ title: 'Participant Added' });
        },
        [groupId, fetchGroup, toast]
    );

    const removeParticipant = useCallback(
        async (employeeId: string) => {
            if (!groupId) throw new Error('No group selected');
            await groupParticipantService.remove(groupId, employeeId);
            await fetchGroup();
            toast({ title: 'Participant Removed' });
        },
        [groupId, fetchGroup, toast]
    );

    const updateParticipantRole = useCallback(
        async (employeeId: string, role: BroadcastParticipantRole) => {
            if (!groupId) throw new Error('No group selected');
            await groupParticipantService.updateRole(groupId, employeeId, role);
            await fetchGroup();
            toast({ title: 'Role Updated' });
        },
        [groupId, fetchGroup, toast]
    );

    return {
        group,
        isLoading,
        error,
        refetch: fetchGroup,
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
// useBroadcasts - Broadcasts for a Channel (Manager)
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
    createBroadcast: (
        data: Omit<CreateBroadcastRequest, 'channelId'>
    ) => Promise<void>;
    archiveBroadcast: (broadcastId: string) => Promise<void>;
    unarchiveBroadcast: (broadcastId: string) => Promise<void>;
    togglePin: (broadcastId: string, isPinned: boolean) => Promise<void>;
    // deleteAcknowledgements removed

    // Computed
    pinnedBroadcasts: BroadcastWithDetails[];
    activeBroadcasts: BroadcastWithDetails[];
    archivedCount: number;
}

export function useBroadcasts(channelId: string | null): UseBroadcastsReturn {
    const { user } = useAuth();
    const { toast } = useToast();
    const [broadcasts, setBroadcasts] = useState<BroadcastWithDetails[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [filters, setFilters] = useState<BroadcastFilters>({});
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [archivedCount, setArchivedCount] = useState(0);

    const fetchBroadcasts = useCallback(async () => {
        if (!channelId) {
            setBroadcasts([]);
            setIsLoading(false);
            return;
        }

        try {
            setIsLoading(true);
            setError(null);

            const result = await broadcastService.getByChannelId(channelId, filters, {
                page,
                pageSize: 20,
            });

            setBroadcasts(result.data);
            setTotalPages(result.totalPages);

            // Get archived count
            const archivedResult = await broadcastService.getByChannelId(
                channelId,
                { isArchived: true },
                { page: 1, pageSize: 1 }
            );
            setArchivedCount(archivedResult.total);
        } catch (err) {
            setError(err as Error);
            toast({
                title: 'Error',
                description: 'Failed to load broadcasts',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    }, [channelId, filters, page, toast]);

    useEffect(() => {
        fetchBroadcasts();
    }, [fetchBroadcasts]);

    // Real-time subscription
    useEffect(() => {
        if (!channelId) return;

        const subscription = broadcastRealtimeService.subscribeToChannel(
            channelId,
            () => fetchBroadcasts(),
            (broadcast) => {
                setBroadcasts((prev) =>
                    prev.map((b) => (b.id === broadcast.id ? { ...b, ...broadcast } : b))
                );
            },
            (id) => {
                setBroadcasts((prev) => prev.filter((b) => b.id !== id));
            }
        );

        return () => {
            broadcastRealtimeService.unsubscribe(subscription);
        };
    }, [channelId, fetchBroadcasts]);

    // Actions - use user.id
    const createBroadcast = useCallback(
        async (data: Omit<CreateBroadcastRequest, 'channelId'>) => {
            if (!user?.id) throw new Error('User not authenticated');
            if (!channelId) throw new Error('No channel selected');

            try {
                await broadcastService.create({ ...data, channelId }, user.id);
                toast({
                    title: 'Broadcast Sent',
                    description: 'Your message has been delivered.',
                });
                await fetchBroadcasts();
            } catch (err) {
                toast({
                    title: 'Error',
                    description: 'Failed to send broadcast',
                    variant: 'destructive',
                });
                throw err;
            }
        },
        [user?.id, channelId, fetchBroadcasts, toast]
    );

    const archiveBroadcast = useCallback(
        async (broadcastId: string) => {
            if (!user?.id) throw new Error('User not authenticated');

            try {
                await broadcastService.archive(broadcastId, user.id);
                setBroadcasts((prev) => prev.filter((b) => b.id !== broadcastId));
                setArchivedCount((prev) => prev + 1);
                toast({ title: 'Broadcast Archived' });
            } catch (err) {
                toast({
                    title: 'Error',
                    description: 'Failed to archive broadcast',
                    variant: 'destructive',
                });
                throw err;
            }
        },
        [user?.id, toast]
    );

    const unarchiveBroadcast = useCallback(
        async (broadcastId: string) => {
            try {
                await broadcastService.unarchive(broadcastId);
                toast({ title: 'Broadcast Unarchived' });
                await fetchBroadcasts();
            } catch (err) {
                toast({
                    title: 'Error',
                    description: 'Failed to unarchive broadcast',
                    variant: 'destructive',
                });
                throw err;
            }
        },
        [fetchBroadcasts, toast]
    );

    const togglePin = useCallback(
        async (broadcastId: string, isPinned: boolean) => {
            try {
                await broadcastService.togglePin(broadcastId, isPinned);
                setBroadcasts((prev) =>
                    prev.map((b) => (b.id === broadcastId ? { ...b, isPinned } : b))
                );
                toast({ title: isPinned ? 'Broadcast Pinned' : 'Broadcast Unpinned' });
            } catch (err) {
                toast({
                    title: 'Error',
                    description: 'Failed to update pin status',
                    variant: 'destructive',
                });
                throw err;
            }
        },
        [toast]
    );

    // deleteAcknowledgements removed

    // Computed
    const pinnedBroadcasts = useMemo(
        () => broadcasts.filter((b) => b.isPinned && !b.isArchived),
        [broadcasts]
    );

    const activeBroadcasts = useMemo(
        () => broadcasts.filter((b) => !b.isPinned && !b.isArchived),
        [broadcasts]
    );

    return {
        broadcasts,
        isLoading,
        error,
        refetch: fetchBroadcasts,
        filters,
        setFilters,
        page,
        totalPages,
        setPage,
        createBroadcast,
        archiveBroadcast,
        unarchiveBroadcast,
        togglePin,
        pinnedBroadcasts,
        activeBroadcasts,
        archivedCount,
    };
}

// ============================================================
// useEmployeeBroadcasts - Broadcasts for Employee View
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

export function useEmployeeBroadcasts(
    channelId: string | null
): UseEmployeeBroadcastsReturn {
    const { user } = useAuth();
    const [broadcasts, setBroadcasts] = useState<BroadcastWithDetails[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);

    // Reset state when channel changes
    useEffect(() => {
        setBroadcasts([]);
        setPage(1);
        setTotalPages(1);
        setIsLoading(true);
    }, [channelId]);

    const fetchBroadcasts = useCallback(
        async (isLoadMore = false) => {
            if (!channelId || !user?.id) {
                setBroadcasts([]);
                setIsLoading(false);
                return;
            }

            try {
                if (isLoadMore) {
                    setIsLoadingMore(true);
                } else {
                    setIsLoading(true);
                }
                setError(null);

                const currentPage = isLoadMore ? page + 1 : 1;

                const result = await broadcastService.getForEmployee(
                    channelId,
                    user.id,
                    { page: currentPage, pageSize: 20 }
                );

                if (isLoadMore) {
                    setBroadcasts((prev) => [...prev, ...result.data]);
                    setPage((p) => p + 1);
                } else {
                    setBroadcasts(result.data);
                    setPage(1);
                }

                setTotalPages(result.totalPages);
            } catch (err) {
                setError(err as Error);
            } finally {
                setIsLoading(false);
                setIsLoadingMore(false);
            }
        },
        [channelId, user?.id, page]
    );

    // Initial load
    useEffect(() => {
        fetchBroadcasts();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [channelId, user?.id]);

    const loadMore = useCallback(() => {
        if (!isLoadingMore && page < totalPages) {
            fetchBroadcasts(true);
        }
    }, [isLoadingMore, page, totalPages, fetchBroadcasts]);

    return {
        broadcasts,
        isLoading,
        isLoadingMore,
        error,
        refetch: () => fetchBroadcasts(false),
        loadMore,
        hasMore: page < totalPages,
    };
}

// ============================================================
// useBroadcastAcknowledgements - Acknowledgement Details
// ============================================================

// ============================================================
// useBroadcastAcknowledgements - DEPRECATED / REMOVED
// ============================================================

// Hook removed as part of Phase 1 Cleanup

// ============================================================
// useBroadcastNotifications - User Notifications
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
    const [notifications, setNotifications] = useState<BroadcastNotification[]>(
        []
    );
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const fetchNotifications = useCallback(async () => {
        if (!user?.id) {
            setNotifications([]);
            setIsLoading(false);
            return;
        }

        try {
            setIsLoading(true);
            setError(null);
            const data = await broadcastNotificationService.getForUser(
                user.id
            );
            setNotifications(data);
        } catch (err) {
            setError(err as Error);
        } finally {
            setIsLoading(false);
        }
    }, [user?.id]);

    useEffect(() => {
        fetchNotifications();
    }, [fetchNotifications]);

    // Real-time subscription
    useEffect(() => {
        if (!user?.id) return;

        const subscription = broadcastRealtimeService.subscribeToNotifications(
            user.id,
            (notification) => {
                setNotifications((prev) => [notification, ...prev]);
                toast({
                    title: notification.subject,
                    description: `New broadcast from ${notification.authorName} in ${notification.groupName}`,
                });
            }
        );

        return () => {
            broadcastRealtimeService.unsubscribe(subscription);
        };
    }, [user?.id, toast]);

    const unreadCount = useMemo(
        () => notifications.filter((n) => !n.isRead).length,
        [notifications]
    );

    const markAsRead = useCallback(async (notificationId: string) => {
        await broadcastNotificationService.markAsRead(notificationId);
        setNotifications((prev) =>
            prev.map((n) => (n.id === notificationId ? { ...n, isRead: true } : n))
        );
    }, []);

    const markAllAsRead = useCallback(async () => {
        if (!user?.id) return;
        await broadcastNotificationService.markAllAsRead(user.id);
        setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    }, [user?.id]);

    return {
        notifications,
        unreadCount,
        isLoading,
        error,
        refetch: fetchNotifications,
        markAsRead,
        markAllAsRead,
    };
}
