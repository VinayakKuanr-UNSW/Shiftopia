-- Recreate missing views for Broadcasts module

-- 1. v_channels_with_stats
CREATE OR REPLACE VIEW v_channels_with_stats AS
SELECT
    c.id,
    c.group_id,
    c.name,
    c.description,
    c.is_active,
    c.created_at,
    c.updated_at,
    (SELECT COUNT(*) FROM broadcasts b WHERE b.channel_id = c.id AND b.is_archived = false) AS active_broadcast_count,
    (SELECT COUNT(*) FROM broadcasts b WHERE b.channel_id = c.id) AS total_broadcast_count,
    (SELECT MAX(created_at) FROM broadcasts b WHERE b.channel_id = c.id) AS last_broadcast_at
FROM broadcast_channels c;

-- 2. v_unread_broadcasts_by_group
CREATE OR REPLACE VIEW v_unread_broadcasts_by_group AS
SELECT
    gp.group_id,
    gp.employee_id,
    COUNT(DISTINCT b.id) FILTER (WHERE brs.read_at IS NULL) AS unread_count,
    BOOL_OR(b.priority = 'urgent' AND brs.read_at IS NULL) AS has_urgent_unread,
    BOOL_OR(b.requires_acknowledgement = true AND ba.acknowledged_at IS NULL) AS has_pending_ack
FROM group_participants gp
JOIN broadcast_channels c ON c.group_id = gp.group_id
JOIN broadcasts b ON b.channel_id = c.id AND b.is_archived = false
LEFT JOIN broadcast_read_status brs ON brs.broadcast_id = b.id AND brs.employee_id = gp.employee_id
LEFT JOIN broadcast_acknowledgements ba ON ba.broadcast_id = b.id AND ba.employee_id = gp.employee_id
GROUP BY gp.group_id, gp.employee_id;

-- 3. v_broadcast_groups_with_stats
CREATE OR REPLACE VIEW v_broadcast_groups_with_stats AS
SELECT
    g.id,
    g.name,
    g.description,
    g.department_id,
    g.sub_department_id,
    g.organization_id,
    g.created_by,
    g.is_active,
    g.icon,
    g.color,
    g.created_at,
    g.updated_at,
    (SELECT COUNT(*) FROM broadcast_channels c WHERE c.group_id = g.id AND c.is_active = true) AS channel_count,
    (SELECT COUNT(*) FROM group_participants gp WHERE gp.group_id = g.id) AS participant_count,
    COALESCE(SUM(c_stats.active_broadcast_count), 0) AS active_broadcast_count,
    COALESCE(SUM(c_stats.total_broadcast_count), 0) AS total_broadcast_count,
    MAX(c_stats.last_broadcast_at) AS last_broadcast_at
FROM broadcast_groups g
LEFT JOIN v_channels_with_stats c_stats ON c_stats.group_id = g.id
GROUP BY g.id;
