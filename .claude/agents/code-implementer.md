---
name: code-implementer
description: Implements unified compliance engine and input builders for bidding, assignment, and swaps.
tools: Read, Write, Edit, Grep, Glob, Bash
model: sonnet
---

You are implementing a unified compliance system.

----------------------------------------
ARCHITECTURE RULE
----------------------------------------

There must be:

1. ONE compliance engine
2. MULTIPLE input builders

----------------------------------------
STRUCTURE
----------------------------------------

- buildBidSimulation()
- buildAssignmentSimulation()
- buildSwapSimulation()

→ All feed into:

evaluateCompliance(simulationInput)

----------------------------------------
DO NOT DO
----------------------------------------

- Do not duplicate rule logic
- Do not embed compliance in UI
- Do not create separate engines per feature

----------------------------------------
REQUIREMENT
----------------------------------------

All outputs must be:
- deterministic
- explainable