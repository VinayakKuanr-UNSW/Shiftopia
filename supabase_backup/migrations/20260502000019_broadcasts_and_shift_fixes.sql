-- Migration 20260502000019: Broadcasts and Shift Fixes

-- 1. Add missing columns to shifts
ALTER TABLE public.shifts 
    ADD COLUMN IF NOT EXISTS last_dropped_by uuid REFERENCES public.profiles(id),
    ADD COLUMN IF NOT EXISTS last_rejected_by uuid REFERENCES public.profiles(id);

-- 2. Broadcast Groups
CREATE TABLE IF NOT EXISTS public.broadcast_groups (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                text NOT NULL,
    description         text,
    organization_id     uuid REFERENCES public.organizations(id),
    department_id       uuid REFERENCES public.departments(id),
    sub_department_id   uuid REFERENCES public.sub_departments(id),
    created_by          uuid REFERENCES public.profiles(id),
    is_active           boolean NOT NULL DEFAULT true,
    icon                text,
    color               text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- 3. Group Participants
CREATE TABLE IF NOT EXISTS public.group_participants (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id    uuid NOT NULL REFERENCES public.broadcast_groups(id) ON DELETE CASCADE,
    employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role        text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'broadcaster', 'lead', 'member')),
    joined_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE(group_id, employee_id)
);

-- 4. Broadcast Channels
CREATE TABLE IF NOT EXISTS public.broadcast_channels (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id    uuid NOT NULL REFERENCES public.broadcast_groups(id) ON DELETE CASCADE,
    name        text NOT NULL,
    description text,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 5. Broadcasts
CREATE TABLE IF NOT EXISTS public.broadcasts (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id                uuid NOT NULL REFERENCES public.broadcast_channels(id) ON DELETE CASCADE,
    author_id                 uuid NOT NULL REFERENCES public.profiles(id),
    organization_id           uuid REFERENCES public.organizations(id),
    subject                   text NOT NULL,
    content                   text NOT NULL,
    priority                  text NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
    is_pinned                 boolean NOT NULL DEFAULT false,
    is_archived               boolean NOT NULL DEFAULT false,
    requires_acknowledgement  boolean NOT NULL DEFAULT false,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now()
);

-- 6. Broadcast Attachments
CREATE TABLE IF NOT EXISTS public.broadcast_attachments (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    broadcast_id  uuid NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
    file_url      text NOT NULL,
    file_name     text NOT NULL,
    file_type     text NOT NULL,
    file_size     bigint,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- 7. Broadcast Read Status
CREATE TABLE IF NOT EXISTS public.broadcast_read_status (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    broadcast_id  uuid NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
    employee_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    read_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE(broadcast_id, employee_id)
);

-- 8. Broadcast Acknowledgements
CREATE TABLE IF NOT EXISTS public.broadcast_acknowledgements (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    broadcast_id    uuid NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
    employee_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    acknowledged_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(broadcast_id, employee_id)
);

-- 9. Broadcast Notifications
CREATE TABLE IF NOT EXISTS public.broadcast_notifications (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    broadcast_id  uuid NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
    channel_id    uuid NOT NULL REFERENCES public.broadcast_channels(id) ON DELETE CASCADE,
    employee_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    subject       text NOT NULL,
    author_name   text NOT NULL,
    priority      text NOT NULL,
    is_read       boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- 10. Enable RLS
ALTER TABLE public.broadcast_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_read_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_notifications ENABLE ROW LEVEL SECURITY;

-- 11. Policies
DO $$ 
BEGIN
    DROP POLICY IF EXISTS auth_read_broadcast_groups ON public.broadcast_groups;
    CREATE POLICY auth_read_broadcast_groups ON public.broadcast_groups FOR SELECT TO authenticated USING (true);
    
    DROP POLICY IF EXISTS auth_read_group_participants ON public.group_participants;
    CREATE POLICY auth_read_group_participants ON public.group_participants FOR SELECT TO authenticated USING (true);
    
    DROP POLICY IF EXISTS auth_read_broadcast_channels ON public.broadcast_channels;
    CREATE POLICY auth_read_broadcast_channels ON public.broadcast_channels FOR SELECT TO authenticated USING (true);
    
    DROP POLICY IF EXISTS auth_read_broadcasts ON public.broadcasts;
    CREATE POLICY auth_read_broadcasts ON public.broadcasts FOR SELECT TO authenticated USING (true);
    
    DROP POLICY IF EXISTS auth_read_broadcast_attachments ON public.broadcast_attachments;
    CREATE POLICY auth_read_broadcast_attachments ON public.broadcast_attachments FOR SELECT TO authenticated USING (true);
    
    DROP POLICY IF EXISTS auth_read_broadcast_read_status ON public.broadcast_read_status;
    CREATE POLICY auth_read_broadcast_read_status ON public.broadcast_read_status FOR SELECT TO authenticated USING (true);
    
    DROP POLICY IF EXISTS auth_read_broadcast_acknowledgements ON public.broadcast_acknowledgements;
    CREATE POLICY auth_read_broadcast_acknowledgements ON public.broadcast_acknowledgements FOR SELECT TO authenticated USING (true);
    
    DROP POLICY IF EXISTS auth_read_broadcast_notifications ON public.broadcast_notifications;
    CREATE POLICY auth_read_broadcast_notifications ON public.broadcast_notifications FOR SELECT TO authenticated USING (true);
END $$;

-- 12. RPCs

-- withdraw_bid_rpc
CREATE OR REPLACE FUNCTION public.withdraw_bid_rpc(p_bid_id uuid, p_employee_id uuid)
RETURNS void AS $$
BEGIN
    UPDATE public.shift_bids
    SET status = 'withdrawn', updated_at = now()
    WHERE id = p_bid_id AND employee_id = p_employee_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- sm_select_bid_winner
CREATE OR REPLACE FUNCTION public.sm_select_bid_winner(p_shift_id uuid, p_winner_id uuid)
RETURNS jsonb AS $$
DECLARE
    v_success boolean := false;
    v_error text;
BEGIN
    -- 1. Accept winner
    UPDATE public.shift_bids
    SET status = 'accepted', updated_at = now()
    WHERE shift_id = p_shift_id AND employee_id = p_winner_id;

    -- 2. Reject others
    UPDATE public.shift_bids
    SET status = 'rejected', updated_at = now()
    WHERE shift_id = p_shift_id AND employee_id != p_winner_id AND status = 'pending';

    -- 3. Assign shift
    UPDATE public.shifts
    SET 
        assigned_employee_id = p_winner_id,
        assigned_at = now(),
        bidding_status = 'not_on_bidding',
        lifecycle_status = 'Confirmed',
        updated_at = now()
    WHERE id = p_shift_id;

    v_success := true;
    RETURN jsonb_build_object('success', v_success);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- get_broadcast_ack_stats
CREATE OR REPLACE FUNCTION public.get_broadcast_ack_stats(broadcast_uuid uuid)
RETURNS TABLE(total bigint, acknowledged bigint, pending bigint, percent numeric) AS $$
DECLARE
    v_group_id uuid;
    v_total bigint;
    v_acknowledged bigint;
BEGIN
    -- Get group_id from broadcast -> channel -> group
    SELECT bc.group_id INTO v_group_id
    FROM public.broadcasts b
    JOIN public.broadcast_channels bc ON b.channel_id = bc.id
    WHERE b.id = broadcast_uuid;

    -- Total participants in the group
    SELECT count(*) INTO v_total
    FROM public.group_participants
    WHERE group_id = v_group_id;

    -- Acknowledged count
    SELECT count(*) INTO v_acknowledged
    FROM public.broadcast_acknowledgements
    WHERE broadcast_id = broadcast_uuid;

    RETURN QUERY SELECT 
        v_total as total,
        v_acknowledged as acknowledged,
        (v_total - v_acknowledged) as pending,
        CASE WHEN v_total > 0 THEN (v_acknowledged::numeric / v_total::numeric) * 100 ELSE 0 END as percent;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 13. Views

DROP VIEW IF EXISTS public.v_unread_broadcasts_by_group;
DROP VIEW IF EXISTS public.v_channels_with_stats;
DROP VIEW IF EXISTS public.v_broadcast_groups_with_stats;

CREATE OR REPLACE VIEW public.v_broadcast_groups_with_stats AS
SELECT 
    bg.*,
    (SELECT count(*) FROM public.broadcast_channels bc WHERE bc.group_id = bg.id AND bc.is_active = true) as channel_count,
    (SELECT count(*) FROM public.group_participants gp WHERE gp.group_id = bg.id) as participant_count,
    (SELECT count(*) FROM public.broadcasts b JOIN public.broadcast_channels bc ON b.channel_id = bc.id WHERE bc.group_id = bg.id AND b.is_archived = false) as active_broadcast_count,
    (SELECT count(*) FROM public.broadcasts b JOIN public.broadcast_channels bc ON b.channel_id = bc.id WHERE bc.group_id = bg.id) as total_broadcast_count,
    (SELECT max(b.created_at) FROM public.broadcasts b JOIN public.broadcast_channels bc ON b.channel_id = bc.id WHERE bc.group_id = bg.id) as last_broadcast_at
FROM public.broadcast_groups bg;

CREATE OR REPLACE VIEW public.v_channels_with_stats AS
SELECT 
    bc.*,
    (SELECT count(*) FROM public.broadcasts b WHERE b.channel_id = bc.id AND b.is_archived = false) as active_broadcast_count,
    (SELECT count(*) FROM public.broadcasts b WHERE b.channel_id = bc.id) as total_broadcast_count,
    (SELECT max(b.created_at) FROM public.broadcasts b WHERE b.channel_id = bc.id) as last_broadcast_at
FROM public.broadcast_channels bc;

CREATE OR REPLACE VIEW public.v_unread_broadcasts_by_group AS
SELECT 
    gp.employee_id,
    bc.group_id,
    count(b.id) as unread_count,
    bool_or(b.priority = 'urgent') as has_urgent_unread,
    bool_or(b.requires_acknowledgement AND NOT EXISTS (
        SELECT 1 FROM public.broadcast_acknowledgements ba 
        WHERE ba.broadcast_id = b.id AND ba.employee_id = gp.employee_id
    )) as has_pending_ack
FROM public.group_participants gp
JOIN public.broadcast_channels bc ON gp.group_id = bc.group_id
JOIN public.broadcasts b ON bc.id = b.channel_id
LEFT JOIN public.broadcast_read_status brs ON b.id = brs.broadcast_id AND gp.employee_id = brs.employee_id
WHERE brs.id IS NULL AND b.is_archived = false
GROUP BY gp.employee_id, bc.group_id;
