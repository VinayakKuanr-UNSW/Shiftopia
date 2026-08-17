import { createClient } from 'npm:@supabase/supabase-js@2.50.0';
import { getFcmAccessToken } from './googleAuth.ts';
import {
  isHighPriority,
  isRemoteDeliveryAllowed,
  renderNotificationMessage,
  resolveNotificationPolicy,
  type NotificationPolicy,
} from '../_shared/notificationPolicy.ts';

// Sends an FCM remote push when a `notifications` row is inserted. Invoked by a
// Supabase Database Webhook on public.notifications (INSERT). Dormant until the
// three FCM secrets are set — it returns a "skipped" 200 rather than erroring so
// it is safe to deploy before Firebase is configured. See
// docs/push-notifications-setup.md.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const fcmProjectId = Deno.env.get('FCM_PROJECT_ID');
const fcmClientEmail = Deno.env.get('FCM_CLIENT_EMAIL');
const fcmPrivateKey = Deno.env.get('FCM_PRIVATE_KEY');
const webhookSecret = Deno.env.get('PUSH_WEBHOOK_SECRET');

if (!supabaseUrl) throw new Error('[FATAL] Missing SUPABASE_URL');
if (!serviceKey) throw new Error('[FATAL] Missing SUPABASE_SERVICE_ROLE_KEY');

type NotificationRecord = {
  id: string;
  profile_id: string;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function sendToToken(
  accessToken: string,
  token: string,
  record: NotificationRecord,
  policy: NotificationPolicy,
): Promise<Response> {
  return fetch(`https://fcm.googleapis.com/v1/projects/${fcmProjectId}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(createFcmPayload(token, record, policy)),
  });
}

function createFcmPayload(token: string, record: NotificationRecord, policy: NotificationPolicy) {
  const body = policy.delivery === 'digest'
    ? renderNotificationMessage(policy, 1, record.message)
    : record.message ?? '';
  const collapseKey = policy.delivery === 'digest' ? policy.eventType : record.id;
  return {
    message: {
      token,
      notification: { title: record.title, body },
      data: toFcmData(record, policy),
      android: {
        priority: isHighPriority(policy) ? 'HIGH' : 'NORMAL',
        collapse_key: collapseKey,
        notification: { tag: collapseKey },
      },
    },
  };
}

function toFcmData(record: NotificationRecord, policy: NotificationPolicy) {
  return {
    link: record.link ?? '',
    type: record.type ?? 'general',
    event_type: policy.eventType,
    delivery: policy.delivery,
    notification_id: record.id ?? '',
  };
}

function isDeadTokenError(status: number, errorCode: string | undefined): boolean {
  return status === 404 || errorCode === 'UNREGISTERED' || errorCode === 'NOT_FOUND';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  // Optional shared-secret guard for the Database Webhook.
  if (webhookSecret && req.headers.get('x-webhook-secret') !== webhookSecret) {
    return json({ error: 'unauthorized' }, 401);
  }

  try {
    const body = await req.json();
    const record = (body?.record ?? body) as NotificationRecord;
    if (!record?.profile_id) return json({ skipped: 'no profile_id' }, 200);
    const policy = resolveNotificationPolicy(record.type);
    if (!isRemoteDeliveryAllowed(policy)) {
      return json({ skipped: 'in-app-only event', eventType: policy.eventType }, 200);
    }
    if (!fcmProjectId || !fcmClientEmail || !fcmPrivateKey) {
      return json({ skipped: 'FCM not configured', eventType: policy.eventType }, 200);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Respect the account-wide push preference (default on when unset).
    const { data: profile } = await supabase
      .from('profiles')
      .select('preferences')
      .eq('id', record.profile_id)
      .single();
    if (profile?.preferences?.notifications?.push === false) {
      return json({ skipped: 'push disabled by user' }, 200);
    }

    const { data: tokens } = await supabase
      .from('device_push_tokens')
      .select('token')
      .eq('profile_id', record.profile_id)
      .is('disabled_at', null);
    if (!tokens || tokens.length === 0) return json({ skipped: 'no active tokens' }, 200);

    const accessToken = await getFcmAccessToken(fcmClientEmail, fcmPrivateKey);

      const results = await Promise.all(
        tokens.map(async ({ token }) => {
          const response = await sendToToken(accessToken, token, record, policy);
        if (response.ok) return { token, ok: true };
        const errorBody = await response.json().catch(() => ({}));
        const errorCode = errorBody?.error?.details?.[0]?.errorCode ?? errorBody?.error?.status;
        if (isDeadTokenError(response.status, errorCode)) {
          await supabase
            .from('device_push_tokens')
            .update({ disabled_at: new Date().toISOString() })
            .eq('token', token);
        }
        return { token, ok: false, errorCode };
      }),
    );

    return json({ sent: results.filter((r) => r.ok).length, total: results.length, results });
  } catch (error) {
    console.error('[send-push]', error);
    return json({ error: String(error) }, 500);
  }
});
