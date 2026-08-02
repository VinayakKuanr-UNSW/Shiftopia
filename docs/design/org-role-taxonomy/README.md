# Org / Role Taxonomy

| File | Covers |
|---|---|
| [01-hr-schema-design.md](01-hr-schema-design.md) + [01-hr-schema-design.sql](01-hr-schema-design.sql) | Normalized (3NF) `hr` schema: `Organization → Department → Subdepartment → Role`, exactly 8 remuneration levels (0=Trainee, 1–7 progressive tiers) per subdepartment. The `.sql` is the DDL companion to the `.md` design doc. |
| [02-role-forecasting-classification.md](02-role-forecasting-classification.md) | Proposed classification of all 85 live roles (pulled from `public.roles`) into forecasting buckets (`static` / `semi_dynamic` / `dynamic`) that determine how each role's required headcount is computed. |
| [source-data/role-department-level-mapping.csv](source-data/role-department-level-mapping.csv) | Raw Department/SubDepartment/Role/Level/Employment-Type source data feeding the two docs above. |
