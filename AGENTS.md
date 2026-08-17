# AGENTS.md — Working agreement for AI agents on Shiftopia

Read this before starting any task. It applies to **every** agent (Claude, Gemini, etc.).
These rules override default behavior and habits.

Shiftopia is a **workforce-compliance** product: a CP-SAT scheduler (`optimizer-service/`,
Python) plus a TypeScript compliance auditor (`src/modules/compliance/v8/`). Wrong output
here is a **legal** problem, not a cosmetic one. Prove things; don't assume.

---

## 1. Gates — nothing is "done" until these pass, with output shown

Run and **paste the actual output** as proof. Never claim green without it.

| Gate | Command |
|---|---|
| Frontend (canonical) | `npm run verify`  ⟶ `tsc --noEmit && vitest run && vite build` |
| Optimizer (Python) | `cd optimizer-service && OPTIMIZER_AUTH_DISABLED=true python3 -m pytest tests/` |

- The optimizer tests are **not** part of `npm run verify` — run them separately whenever you
  touch anything under `optimizer-service/`. Without `OPTIMIZER_AUTH_DISABLED=true`, several
  tests 503-fail.
- If the venv has no pip, `python3 -m ensurepip` first.

### Do NOT use these as a gate
- `npm run lint`, `npm run lint:fix`, `npm run arch:check` → all invoke **ESLint, which is
  broken repo-wide** (version mismatch, crashes). tsc + vitest are the real correctness gate.
- `npm run ship` → this runs `verify && git push`. **It pushes.** Never run it unless a push
  has been explicitly authorized for this task.

---

## 2. Git discipline

- **Never commit or push to `main`.** Branch first; one initiative per branch. Keep branch
  scope tight — don't pile unrelated work onto a long-lived branch.
- **Commit only when explicitly asked.** Push / open a PR only when explicitly asked.
- **Stage only files you changed for the task.** Never `git add -A` in a way that folds in
  unrelated working-tree edits you didn't author — commit those separately or leave them.
- Conventional-commit messages (`fix(scope): …`, `feat(scope): …`). Explain *why*, not just
  *what*, for non-obvious changes.
- Delete branches at merge time; a fully-merged branch (`git branch --merged main`) is safe to
  prune, an unmerged one is not.

---

## 3. Deploy topology — this trips everyone up

- The **Vercel** project (`shiftopia`) deploys the **frontend only** — `vercel.json` is a pure
  SPA rewrite, there is no `/api`. A Vercel deploy ships the Vite build and nothing else.
- The **`optimizer-service/`** (the CP-SAT solver) is a **containerized Python service
  (Dockerfile)** that deploys through its **own pipeline**. **A Vercel deploy does NOT include
  solver changes.** If you changed `model_builder.py` et al., that only goes live when the
  container is redeployed.
- **Production** tracks `main`. Pushing a feature branch gives a **preview**, not prod.
- **Never deploy to production without explicit go-ahead.** Prefer: open a PR to `main`,
  validate on the preview, then let a human merge.

---

## 4. Correctness ethos

- Treat the ICC Sydney EBA (enterprise agreement) as the source of truth for any scheduling /
  pay / compliance rule. Cite the clause when implementing one.
- **The CP-SAT solver and the V8 auditor must agree on every rule.** If you change a cap,
  threshold, or exemption in one, change it in the other and add tests to both. A roster the
  solver produces must never be one the auditor would block (and vice-versa).
- Objective tiering is lexicographic: **legal_hard » coverage » soft(availability/contract) »
  guardrail(fatigue/fairness) » cost**. Hard legal caps out-rank coverage (an unavoidable
  breach is left uncovered + escalated); availability yields to coverage. Preserve this order.
- Prove behavior with a test or a reproduced run, not by reading the code and asserting it's
  fine. "Don't assume code is correct — prove whether it is."

---

## 5. Architecture quick map

- `src/modules/` — feature modules (compliance, rosters, planning, broadcasts, timesheets…).
- `src/platform/` — infra (auth, supabase, realtime, types).
- `optimizer-service/` — Python CP-SAT autoscheduler (`model_builder.py` is the core) + pytest.
- DB migrations live in `supabase/migrations/`; review RLS impacts before touching them.

---

## 6. Concurrency & Locking Contract

- **All Shift Mutations Route Through `sm_apply_shift_op`**: Direct `UPDATE public.shifts` statements outside `_apply_shift_op_write` are strictly prohibited to prevent lost updates and version CAS bypasses.
- **Employee Assignment Advisory Locks**: All assignment operations MUST acquire a deterministic transactional advisory lock on the target employee identity (`pg_advisory_xact_lock(hashtext('emp_assign:' || employee_id::text))`) before running overlap or compliance checks.
- **Multi-Employee Lock Ordering (Deadlock Prevention)**: When an operation touches multiple employees (e.g., shift trades/swaps), advisory locks MUST be acquired in ascending lexicographical UUID order: `LEAST(empA, empB)` then `GREATEST(empA, empB)`.
- **Background Cron Locks**: All background workers/cron functions MUST acquire a non-blocking advisory lock (`pg_try_advisory_xact_lock(hashtext('job_name'))`) at execution start to guarantee single-execution semantics across multi-replica deployments.

---

_When in doubt: run the gates, show the output, and ask before anything irreversible or
outward-facing (push to main, deploy, delete branches, mutate prod data)._
