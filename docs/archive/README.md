# Archive — superseded / stale, kept for historical trace only

**Do not use anything in this folder as a current reference.** Each entry below is here because it was confirmed stale or superseded during the 2026-08-01 documentation reorg. It's kept rather than deleted only because it may still have historical or forensic value.

| File | Why it's archived | Current source of truth |
|---|---|---|
| [compliance-v2-R07-rest-gap-STALE.md](compliance-v2-R07-rest-gap-STALE.md) | Documents the R07 minimum-rest-gap rule against a **"Compliance Engine v2"** at `src/modules/compliance/v2/...`. That path/version no longer exists. | `src/modules/compliance/v8/` — see [../rulebook/12-compliance-engine.md](../rulebook/12-compliance-engine.md) and [../reference/compliance-v8-rule-catalog.md](../reference/compliance-v8-rule-catalog.md) |
| [2026-02-16_rpc-usage-report-pre-gateway-STALE.md](2026-02-16_rpc-usage-report-pre-gateway-STALE.md) | Per-RPC usage inventory from the "Post-Migration V3" era, before the granular `sm_*`/`*_rpc` calls were consolidated behind one gateway. | `sm_apply_shift_op` gateway — see [../rulebook/07-state-machines.md](../rulebook/07-state-machines.md) and [../rulebook/17-production-audit.md](../rulebook/17-production-audit.md) (which notes the old RPCs as a dead-code "graveyard") |
| [availability-rules-schema-design-notes-UNVERIFIED.txt](availability-rules-schema-design-notes-UNVERIFIED.txt) | Prose+SQL design notes proposing an `availability_rules` schema. Never confirmed against what was actually built — memory/other docs indicate the live source of truth is `availability_slots`, which may or may not match this design. | Check the live schema directly (`availability_slots` table) before trusting this |

If you're about to cite one of these files in new work, stop and verify against the current codebase/DB first — that's exactly the mistake that made them archive candidates.
