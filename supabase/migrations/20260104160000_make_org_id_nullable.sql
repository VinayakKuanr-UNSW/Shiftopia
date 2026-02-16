-- Make organization_id nullable for broadcast related tables since we are not strictly using it yet
DO $$
BEGIN
    -- BroadcastGroups
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'broadcast_groups' AND column_name = 'organization_id') THEN
        ALTER TABLE broadcast_groups ALTER COLUMN organization_id DROP NOT NULL;
    END IF;

    -- Broadcasts
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'broadcasts' AND column_name = 'organization_id') THEN
        ALTER TABLE broadcasts ALTER COLUMN organization_id DROP NOT NULL;
    END IF;

    -- GroupParticipants
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'group_participants' AND column_name = 'organization_id') THEN
        ALTER TABLE group_participants ALTER COLUMN organization_id DROP NOT NULL;
    END IF;

    -- Also check BroadcastChannels just in case
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'broadcast_channels' AND column_name = 'organization_id') THEN
        ALTER TABLE broadcast_channels ALTER COLUMN organization_id DROP NOT NULL;
    END IF;
END $$;
