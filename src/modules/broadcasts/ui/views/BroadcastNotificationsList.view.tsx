import React, { useState } from 'react';
import { Bell, BellOff, Check, CheckCheck, Clock } from 'lucide-react';
import { useAuth } from '@/platform/auth/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/modules/core/ui/primitives/card';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import { formatDistanceToNow } from 'date-fns';
import { useBroadcastNotifications } from '../../state/useBroadcasts';
import { PageState } from '@/modules/core/ui/components/PageState';

export const BroadcastNotificationsList: React.FC = () => {
    const { user } = useAuth();
    const {
        notifications,
        isLoading,
        markAsRead,
        markAllAsRead,
        refetch
    } = useBroadcastNotifications();

    // Derived state for local loading of specific actions if needed
    const [isMarkingAll, setIsMarkingAll] = useState(false);

    const handleMarkAllRead = async () => {
        setIsMarkingAll(true);
        await markAllAsRead();
        setIsMarkingAll(false);
    };

    const unreadCount = notifications.filter(n => !n.isRead).length;

    if (isLoading) {
        return (
            <Card>
                <PageState
                    state="loading"
                    scope="section"
                    title="Loading broadcast notifications"
                    skeleton={
                        <div className="space-y-4" aria-hidden="true">
                            <Skeleton className="h-6 w-48" />
                            <Skeleton className="h-20 w-full" />
                            <Skeleton className="h-20 w-full" />
                            <Skeleton className="h-20 w-full" />
                        </div>
                    }
                />
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2">
                    <Bell className="h-5 w-5" />
                    Broadcast Notifications
                    {unreadCount > 0 && (
                        <Badge variant="destructive" className="ml-2">
                            {unreadCount} new
                        </Badge>
                    )}
                </CardTitle>
                {unreadCount > 0 && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleMarkAllRead}
                        disabled={isMarkingAll}
                    >
                        <CheckCheck className="mr-2 h-4 w-4" />
                        {isMarkingAll ? "Marking..." : "Mark All Read"}
                    </Button>
                )}
            </CardHeader>
            <CardContent>
                {notifications.length === 0 ? (
                    <PageState
                        state="empty"
                        scope="inline"
                        title="No notifications yet"
                        description="You’ll receive notifications when broadcasts are sent to your groups."
                        icon={BellOff}
                    />
                ) : (
                    <div className="space-y-3">
                        {notifications.map((notification) => (
                            <div
                                key={notification.id}
                                className={`border rounded-lg p-4 transition-colors ${!notification.isRead ? 'bg-blue-50 border-blue-200 dark:bg-primary/5 dark:border-primary/10' : 'bg-background'
                                    }`}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2">
                                        <Badge variant={notification.isRead ? "secondary" : "default"}>
                                            {notification.priority.replace('_', ' ')}
                                        </Badge>
                                        {!notification.isRead && (
                                            <Badge variant="destructive" className="text-xs">
                                                New
                                            </Badge>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Clock className="h-3 w-3" />
                                        {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                                    </div>
                                </div>

                                <div className="mb-3">
                                    <div className="font-medium mb-1">
                                        {notification.subject}
                                    </div>
                                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                                        {notification.authorName}
                                    </p>
                                </div>

                                <div className="flex justify-end">
                                    {!notification.isRead && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => markAsRead(notification.id)}
                                        >
                                            <Check className="mr-2 h-4 w-4" />
                                            Mark as Read
                                        </Button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
};
