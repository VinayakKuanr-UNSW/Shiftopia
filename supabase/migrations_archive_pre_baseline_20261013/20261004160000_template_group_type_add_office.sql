-- Migration: 20261004160000_template_group_type_add_office.sql
-- Description: Add 'office' to the roster group enum — the fifth fixed group.
--
-- Full-time shifts move onto the Rosters page in a group of their own, Office,
-- sub-group Administration (handover 2026-10-04, D2). Everything that makes the
-- group real — allow-list, seeding, template apply, backfill, moving the existing
-- FT shifts — is in 20261004160100_office_fixed_group.sql.
--
-- ALONE ON PURPOSE. A value added by ALTER TYPE ... ADD VALUE cannot be used in
-- the transaction that added it, and the next migration both casts to it and
-- writes rows with it. Same split as The Cutaway (20260609010000).

ALTER TYPE public.template_group_type ADD VALUE IF NOT EXISTS 'office';
