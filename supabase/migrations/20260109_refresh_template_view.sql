-- Migration: Fix Template Schema and Refresh View
-- Date: 2026-01-09
-- Purpose: Ensure template_shifts has day_of_week and v_template_full is defined correctly.

-- 1. Ensure Schema (Handle missing columns from older migrations)
ALTER TABLE template_shifts ADD COLUMN IF NOT EXISTS day_of_week integer;
ALTER TABLE template_shifts ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES roles(id);
ALTER TABLE template_shifts ADD COLUMN IF NOT EXISTS start_time time;
ALTER TABLE template_shifts ADD COLUMN IF NOT EXISTS end_time time;
ALTER TABLE template_shifts ADD COLUMN IF NOT EXISTS subgroup_id uuid REFERENCES template_subgroups(id) ON DELETE SET NULL;

-- 2. Define View
DROP VIEW IF EXISTS v_template_full;

CREATE OR REPLACE VIEW v_template_full AS
SELECT
    t.*,
    COALESCE(
        (
            SELECT json_agg(g ORDER BY g.sort_order)
            FROM (
                SELECT
                    tg.id,
                    tg.name,
                    tg.color,
                    tg.sort_order,
                    (
                        SELECT json_agg(sg ORDER BY sg.sort_order)
                        FROM (
                            SELECT
                                tsg.id,
                                tsg.name,
                                tsg.sort_order,
                                (
                                    SELECT json_agg(
                                        json_build_object(
                                            'id', s.id,
                                            'startTime', to_char(s.start_time, 'HH24:MI'),
                                            'endTime', to_char(s.end_time, 'HH24:MI'),
                                            'roleId', s.role_id,
                                            'dayOfWeek', s.day_of_week
                                        ) ORDER BY s.start_time
                                    )
                                    FROM template_shifts s
                                    WHERE s.subgroup_id = tsg.id
                                ) as shifts
                            FROM template_subgroups tsg
                            WHERE tsg.group_id = tg.id
                        ) sg
                    ) as "subGroups"
                FROM template_groups tg
                WHERE tg.template_id = t.id
            ) g
        ),
        '[]'::json
    ) as groups
FROM roster_templates t;
