# Reference Data

Stable, structured reference material — tables and catalogs rather than narrative docs.

| File | Covers |
|---|---|
| [compliance-v8-rule-catalog.md](compliance-v8-rule-catalog.md) | Detailed EBA rule algorithms for ICC Sydney enforced by the V8 Compliance Engine (rule IDs, sliding-window formulas, thresholds). **Supplementary detail** — for the authoritative list of all 21 rule IDs, orchestration flow, and real entry points, see [../rulebook/12-compliance-engine.md](../rulebook/12-compliance-engine.md) first; this file goes one level deeper on the algorithms for the rules it covers. |
| [fsm-states.csv](fsm-states.csv) | Shift FSM state table (S1–S15): labels, lifecycle stage, terminal flags. |
| [fsm-transitions.csv](fsm-transitions.csv) | Shift FSM transition table: from-state, action, to-state. |
| [shift-card-ui-scenarios.csv](shift-card-ui-scenarios.csv) | UI scenario spec for shift cards: urgency colors/icons/time-display rules per state. |

Cross-check against [../rulebook/07-state-machines.md](../rulebook/07-state-machines.md) for the FSM's live-verified, source-traced version if the two ever disagree.
