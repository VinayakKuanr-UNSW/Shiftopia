"""
AutoScheduler load test — capacity planning against realistic shapes.

Runs a matrix of problem sizes against `/optimize` and `/audit`,
collects latency + solver-status distributions, prints a markdown
report. Use it before bumping per-tenant rate limits or claiming a
specific scaling SLA.

Usage:
    # Defaults: localhost optimizer with dev-bypass auth
    python scripts/loadtest.py

    # Hit a deployed environment
    OPTIMIZER_URL=https://optimizer.example.com \
    OPTIMIZER_TOKEN=<jwt> \
        python scripts/loadtest.py

    # Tighten the matrix (faster smoke), or add concurrency
    python scripts/loadtest.py --concurrency 4 --quick

The script does NOT mutate state — `/optimize` is read-only by design
(proposals only). Safe to run against production with auth + a token.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import statistics
import time
from dataclasses import dataclass

import httpx


# ---------------------------------------------------------------------------
# Problem-shape generation
# ---------------------------------------------------------------------------

def make_problem(num_shifts: int, num_employees: int) -> dict:
    """Generate a synthetic problem of the requested size with shapes
    that resemble production: morning-cluster shifts spread across 28
    days, FT employees with 2400m weekly cap.

    Realistic enough to exercise:
      - The interval-variable refactor (overlap density)
      - Workload window constraints (cross-week)
      - Eligibility filter (uniform pool, no role/skill filters)
    """
    shifts = []
    days = max(1, num_shifts // 6)  # 6 morning shifts per day on average
    for d in range(days):
        date = f"2026-05-{((d % 28) + 1):02d}"
        for h in range(min(6, num_shifts - len(shifts))):
            sid = f"s{d}_{h}"
            # Morning cluster: 06:00-14:00 → 14:00-22:00, 30-min stagger
            start_h = 6 + h
            shifts.append({
                "id": sid, "shift_date": date,
                "start_time": f"{start_h:02d}:00",
                "end_time": f"{start_h + 8:02d}:00",
                "duration_minutes": 480, "role_id": "role-A",
                "priority": 1, "level": 0, "is_training": False,
                "unpaid_break_minutes": 0,
            })
            if len(shifts) >= num_shifts:
                break
        if len(shifts) >= num_shifts:
            break

    employees = [
        {
            "id": f"e{i}", "name": f"E{i}",
            "employment_type": "FT", "hourly_rate": 25.65,
            "min_contract_minutes": 0, "max_weekly_minutes": 2400,
            "level": 0,
            "existing_shifts": [],
            "has_availability_data": False, "availability_slots": [],
        }
        for i in range(num_employees)
    ]

    return {
        "shifts": shifts, "employees": employees,
        "constraints": {
            "min_rest_minutes": 600, "relax_constraints": False,
            "enforce_role_match": False, "enforce_skill_match": False,
            "allow_partial": True,
        },
        "strategy": {
            "fatigue_weight": 50, "fairness_weight": 50,
            "cost_weight": 50, "coverage_weight": 100,
        },
        "solver_params": {
            "max_time_seconds": 30,
            "num_workers": 4,
            "enable_greedy_hint": True,
        },
    }


# ---------------------------------------------------------------------------
# Run harness
# ---------------------------------------------------------------------------

@dataclass
class Result:
    label: str
    latency_ms: float
    status: str            # 'OK', 'FAIL', or solver status (OPTIMAL/FEASIBLE/etc.)
    coverage: float        # 0..1, fraction of shifts assigned
    constraints: int       # solver constraint count


async def run_one(client: httpx.AsyncClient, url: str, payload: dict,
                  headers: dict, label: str) -> Result:
    t0 = time.perf_counter()
    try:
        r = await client.post(url, json=payload, headers=headers, timeout=120)
        elapsed = (time.perf_counter() - t0) * 1000
        if r.status_code != 200:
            return Result(label, elapsed, f'HTTP_{r.status_code}', 0.0, 0)
        body = r.json()
        if 'assignments' in body:  # /optimize response
            total = len(payload['shifts'])
            assigned = len(body['assignments'])
            return Result(
                label, elapsed,
                body['status'],
                assigned / total if total else 0.0,
                body.get('debug', {}).get('num_constraints', 0),
            )
        if 'audited_shift_count' in body:  # /audit response
            return Result(label, elapsed, 'OK',
                          1.0,  # audit doesn't have a coverage notion
                          0)
        return Result(label, elapsed, 'UNKNOWN', 0.0, 0)
    except Exception as exc:
        elapsed = (time.perf_counter() - t0) * 1000
        return Result(label, elapsed, f'EXC:{type(exc).__name__}', 0.0, 0)


async def run_matrix(base_url: str, token: str, concurrency: int, quick: bool):
    # Problem-shape matrix. (shifts, employees) tuples.
    shapes = [
        (50, 30),
        (200, 50),
        (500, 100),
    ]
    if not quick:
        shapes.extend([
            (1000, 200),
            (2000, 300),
        ])

    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'

    timeout = httpx.Timeout(180.0)
    limits = httpx.Limits(max_connections=concurrency)

    async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
        # Connectivity check
        ready = await client.get(f'{base_url}/ready')
        print(f'[loadtest] /ready → HTTP {ready.status_code} {ready.json() if ready.status_code == 200 else ""}\n')

        all_results: list[Result] = []
        for shape in shapes:
            num_shifts, num_employees = shape
            payload = make_problem(num_shifts, num_employees)
            label = f'{num_shifts}x{num_employees}'

            print(f'[loadtest] {label} optimize × {concurrency} concurrent ...', flush=True)
            tasks = [
                run_one(client, f'{base_url}/optimize', payload, headers, f'{label}/opt')
                for _ in range(concurrency)
            ]
            results = await asyncio.gather(*tasks)
            all_results.extend(results)

            print(f'[loadtest] {label} audit × {concurrency} concurrent ...', flush=True)
            audit_payload = {
                'shifts': payload['shifts'],
                'employees': payload['employees'],
                'constraints': payload['constraints'],
                'target_shift_ids': [s['id'] for s in payload['shifts'][:50]],
            }
            tasks = [
                run_one(client, f'{base_url}/audit', audit_payload, headers, f'{label}/audit')
                for _ in range(concurrency)
            ]
            results = await asyncio.gather(*tasks)
            all_results.extend(results)

        return all_results


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def report(results: list[Result]) -> None:
    # Group by label
    by_label: dict[str, list[Result]] = {}
    for r in results:
        by_label.setdefault(r.label, []).append(r)

    print('\n' + '=' * 72)
    print('Load test report')
    print('=' * 72)
    print(f'{"label":<20} {"n":<4} {"p50_ms":>8} {"p95_ms":>8} {"p99_ms":>8} {"status":<12} {"coverage":>9}')
    print('-' * 72)

    for label in sorted(by_label.keys()):
        rs = by_label[label]
        latencies = sorted(r.latency_ms for r in rs)
        n = len(latencies)
        p50 = latencies[n // 2]
        p95 = latencies[min(n - 1, int(n * 0.95))]
        p99 = latencies[min(n - 1, int(n * 0.99))]
        statuses = {}
        for r in rs:
            statuses[r.status] = statuses.get(r.status, 0) + 1
        status_str = ','.join(f'{k}:{v}' for k, v in statuses.items())
        avg_cov = statistics.mean(r.coverage for r in rs) * 100
        print(f'{label:<20} {n:<4} {p50:>8.1f} {p95:>8.1f} {p99:>8.1f} {status_str:<12} {avg_cov:>8.1f}%')

    print('=' * 72)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--concurrency', type=int, default=2,
                        help='Parallel requests per shape (default: 2)')
    parser.add_argument('--quick', action='store_true',
                        help='Skip the largest (1000+) shapes')
    args = parser.parse_args()

    base_url = os.environ.get('OPTIMIZER_URL', 'http://localhost:5005')
    token = os.environ.get('OPTIMIZER_TOKEN', '')

    print(f'[loadtest] target={base_url} concurrency={args.concurrency} quick={args.quick}')
    if not token:
        print('[loadtest] no OPTIMIZER_TOKEN set — assuming dev-bypass auth')

    results = asyncio.run(run_matrix(base_url, token, args.concurrency, args.quick))
    report(results)


if __name__ == '__main__':
    main()
