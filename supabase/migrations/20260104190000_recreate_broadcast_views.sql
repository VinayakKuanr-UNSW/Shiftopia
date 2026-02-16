-- Recreate views that were dropped when broadcasts table was recreated

-- View: Channels with Stats
CREATE OR REPLACE VIEW v_channels_with_stats AS
SELECT 
  bc.*,
  (SELECT COUNT(*) FROM broadcasts b WHERE b.channel_id = bc.id AND b.is_archived = false) as active_broadcast_count
FROM broadcast_channels bc;

-- View: Broadcast Groups with Stats
CREATE OR REPLACE VIEW v_broadcast_groups_with_stats AS
SELECT 
  bg.*,
  (SELECT COUNT(*) FROM broadcast_channels bc WHERE bc.group_id = bg.id AND bc.is_active = true) as channel_count,
  (SELECT COUNT(*) FROM group_participants gp WHERE gp.group_id = bg.id) as participant_count,
  (
    SELECT COUNT(*) 
    FROM broadcasts b 
    JOIN broadcast_channels bc ON b.channel_id = bc.id 
    WHERE bc.group_id = bg.id AND b.is_archived = false
  ) as active_broadcast_count,
  (
    SELECT MAX(b.created_at)
    FROM broadcasts b 
    JOIN broadcast_channels bc ON b.channel_id = bc.id 
    WHERE bc.group_id = bg.id AND b.is_archived = false
  ) as last_broadcast_at
FROM broadcast_groups bg;

-- View: Unread Broadcasts By Group for Employee
CREATE OR REPLACE VIEW v_unread_broadcasts_by_group AS
SELECT 
  gp.employee_id,
  bg.id as group_id,
  COUNT(b.id) FILTER (WHERE brs.id IS NULL) as unread_count,
  BOOL_OR(b.priority = 'urgent' AND brs.id IS NULL) as has_urgent_unread,
  BOOL_OR(b.requires_acknowledgement = true AND ba.id IS NULL) as has_pending_ack
FROM broadcast_groups bg
JOIN group_participants gp ON bg.id = gp.group_id
JOIN broadcast_channels bc ON bg.id = bc.group_id
JOIN broadcasts b ON bc.id = b.channel_id
LEFT JOIN broadcast_read_status brs ON b.id = brs.broadcast_id AND brs.employee_id = gp.employee_id
LEFT JOIN broadcast_acknowledgements ba ON b.id = ba.broadcast_id AND ba.employee_id = gp.employee_id
WHERE b.is_archived = false
GROUP BY gp.employee_id, bg.id;
