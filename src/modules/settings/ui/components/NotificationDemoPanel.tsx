import { useNavigate } from 'react-router-dom';
import { BellRing, Clock3, Inbox, Trash2, Zap } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { toast } from '@/modules/core/ui/primitives/use-toast';
import { useAuth } from '@/platform/auth/useAuth';
import {
  clearLocalDemoNotifications,
  createLocalDemoNotification,
  type LocalDemoNotificationInput,
} from '@/platform/notifications/localDemoNotifications';
import {
  presentLocalDemoNotification,
  type LocalNotificationPresentation,
} from '@/platform/notifications/localNotifications';
import { resolveNotificationPolicy } from '@/platform/notifications/notificationPolicy';

type DemoPreset = LocalDemoNotificationInput & {
  label: string;
  icon: typeof BellRing;
};

const DEMO_PRESETS: DemoPreset[] = [
  {
    label: 'Shift assigned',
    icon: BellRing,
    type: 'shift_assigned',
    title: 'New shift assigned',
    message: 'You have been assigned a shift tomorrow at 9:00 AM.',
    link: '/my-roster',
  },
  {
    label: 'Urgent call-in',
    icon: Zap,
    type: 'emergency_assignment',
    title: 'Urgent shift assignment',
    message: 'You have been called in urgently to cover a shift starting in 45 minutes.',
    link: '/my-roster',
  },
  {
    label: 'Swap request',
    icon: BellRing,
    type: 'swap_request',
    title: 'New swap request',
    message: 'A colleague is requesting to swap a shift with you.',
    link: '/my-swaps',
  },
  {
    label: 'Bid submitted',
    icon: Inbox,
    type: 'BID_SUBMITTED',
    title: 'Bid submitted',
    message: 'Your bid has been submitted. This event is intentionally in-app only.',
    link: '/my-bids',
  },
  {
    label: 'Bidding digest',
    icon: Clock3,
    type: 'SHIFT_BIDDING_OPEN',
    title: 'Marketplace update',
    message: 'New shifts are available for bidding.',
    link: '/my-bids',
  },
];

export function NotificationDemoPanel() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const triggerDemo = async (preset: DemoPreset) => {
    if (!user?.id) return;
    const { label, type, title, message, link } = preset;
    const input = { type, title, message, link };
    const notification = createLocalDemoNotification(user.id, input);
    const presentation = await presentLocalDemoNotification({
      ...notification,
      scopeId: user.id,
      body: notification.message,
    });
    toast({ title: `${label} demo created`, description: describeDelivery(input.type, presentation) });
  };

  const clearDemo = () => {
    if (!user?.id) return;
    clearLocalDemoNotifications(user.id);
    toast({ title: 'Demo notifications cleared' });
  };

  return (
    <div className="rounded-2xl border border-dashed border-amber-300/30 bg-amber-300/5 p-6" data-demo-controls>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="font-medium text-white">Client demo controls</h4>
          <p className="mt-1 text-sm text-blue-200/60">
            Temporary local triggers. Every demo appears in the bell and notification page without writing to Supabase.
          </p>
        </div>
        <span className="w-fit rounded-full bg-amber-300/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-200">
          Remove later
        </span>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {DEMO_PRESETS.map(({ icon: Icon, ...preset }) => {
          const policy = resolveNotificationPolicy(preset.type);
          return (
            <Button
              key={preset.type}
              variant="outline"
              onClick={() => triggerDemo({ ...preset, icon: Icon })}
              className="h-auto min-h-16 justify-start border-white/10 bg-white/5 px-4 py-3 text-left text-white hover:bg-white/10"
            >
              <Icon className="mr-3 h-4 w-4 shrink-0 text-amber-200" />
              <span>
                <span className="block text-sm font-medium">{preset.label}</span>
                <span className="block text-[10px] uppercase tracking-wide text-white/40">
                  {policy.priority} · {formatDelivery(policy.delivery, policy.cooldownMinutes)}
                </span>
              </span>
            </Button>
          );
        })}
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={clearDemo} className="text-white/60 hover:bg-white/5 hover:text-white">
          <Trash2 className="mr-2 h-4 w-4" />
          Clear demo notifications
        </Button>
        <Button onClick={() => navigate('/my-notifications')}>
          <Inbox className="mr-2 h-4 w-4" />
          Open notification center
        </Button>
      </div>
    </div>
  );
}

function describeDelivery(eventType: string, presentation: LocalNotificationPresentation): string {
  const policy = resolveNotificationPolicy(eventType);
  if (presentation === 'in_app_only') return 'Added to the notification center only, as required by policy.';
  if (presentation === 'permission_denied') {
    return 'Added to the notification center. Allow notifications in Android settings to also show it in the system tray.';
  }
  if (presentation === 'unavailable') return 'Added to the notification center; system alerts require the mobile app.';
  if (presentation === 'failed') return 'Added to the notification center, but the Android system alert could not be created.';
  if (policy.delivery === 'digest') {
    return `Added to the notification center now; the device digest is queued for ${policy.cooldownMinutes} minutes.`;
  }
  return 'Added to the notification center and Android system tray.';
}

function formatDelivery(delivery: string, cooldownMinutes: number): string {
  if (delivery === 'in_app_only') return 'in-app only';
  if (delivery === 'digest') return `${cooldownMinutes}m digest`;
  return 'immediate';
}

export default NotificationDemoPanel;
