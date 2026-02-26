#!/usr/bin/env python3
"""
AURA Metrics Viewer — display active deliverables, completed metrics, and aggregated stats.

Usage: python3 aura-view.py [--json]
"""

import json
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

AURA_DIR = Path.home() / ".aura"
DELIVERABLES_DIR = AURA_DIR / "deliverables"
METRICS_DIR = AURA_DIR / "metrics"

# ── Performance tiers ────────────────────────────────────────────────────────

TIERS = {
    "throughput": [
        ("Elite", lambda v: v >= 3.0),
        ("High", lambda v: v >= 1.0),
        ("Medium", lambda v: v >= 1.0 / 7),
        ("Low", lambda _: True),
    ],
    "latency": [
        ("Elite", lambda v: v < 3600),
        ("High", lambda v: v < 14400),
        ("Medium", lambda v: v < 86400),
        ("Low", lambda _: True),
    ],
    "failure_rate": [
        ("Elite", lambda v: v < 0.05),
        ("High", lambda v: v < 0.10),
        ("Medium", lambda v: v < 0.15),
        ("Low", lambda _: True),
    ],
    "recovery": [
        ("Elite", lambda v: v < 0.05),
        ("High", lambda v: v < 0.10),
        ("Medium", lambda v: v < 0.20),
        ("Low", lambda _: True),
    ],
    "conformance": [
        ("Elite", lambda v: v >= 0.95),
        ("High", lambda v: v >= 0.85),
        ("Medium", lambda v: v >= 0.70),
        ("Low", lambda _: True),
    ],
}


def classify(metric_name: str, value: float) -> str:
    """Classify a metric value into a performance tier."""
    for tier_name, test in TIERS.get(metric_name, []):
        if test(value):
            return tier_name
    return "Unknown"


def tier_color(tier: str) -> str:
    """ANSI color for a tier label."""
    colors = {
        "Elite": "\033[92m",   # bright green
        "High": "\033[94m",    # bright blue
        "Medium": "\033[93m",  # yellow
        "Low": "\033[91m",     # red
    }
    return colors.get(tier, "")


RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"


def format_duration(seconds: int | float) -> str:
    """Format seconds into human-readable duration."""
    if seconds < 60:
        return f"{int(seconds)}s"
    elif seconds < 3600:
        return f"{int(seconds // 60)}m {int(seconds % 60)}s"
    elif seconds < 86400:
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        return f"{h}h {m}m"
    else:
        d = int(seconds // 86400)
        h = int((seconds % 86400) // 3600)
        return f"{d}d {h}h"


def load_active_deliverables() -> list[dict]:
    """Load all active (non-completed) deliverable states."""
    results = []
    if not DELIVERABLES_DIR.exists():
        return results
    for p in sorted(DELIVERABLES_DIR.glob("*.json")):
        try:
            with open(p) as f:
                state = json.load(f)
            if state.get("status") not in ("completed",):
                results.append(state)
        except (json.JSONDecodeError, KeyError):
            continue
    return results


def load_completed_metrics() -> list[dict]:
    """Load all completed deliverable metrics."""
    results = []
    if not METRICS_DIR.exists():
        return results
    for p in sorted(METRICS_DIR.glob("*.json")):
        try:
            with open(p) as f:
                results.append(json.load(f))
        except (json.JSONDecodeError, KeyError):
            continue
    return results


def print_separator(char: str = "─", width: int = 72):
    print(DIM + char * width + RESET)


def display_active(deliverables: list[dict]):
    """Display active deliverables."""
    print(f"\n{BOLD}Active Deliverables{RESET}")
    print_separator()

    if not deliverables:
        print(f"  {DIM}No active deliverables{RESET}")
        return

    for d in deliverables:
        phase = d.get("status", "unknown")
        change_id = d.get("change_id", "unknown")
        started = d.get("started_at", "")

        # Calculate elapsed time
        elapsed = ""
        if started:
            try:
                start_dt = datetime.fromisoformat(started)
                delta = datetime.now(timezone.utc) - start_dt
                elapsed = f" ({format_duration(delta.total_seconds())} elapsed)"
            except ValueError:
                pass

        # Phase progress bar
        phase_idx = PHASES.index(phase) if phase in PHASES else 0
        bar = ""
        phase_names = ["propose", "specs", "design", "tasks", "apply", "verify", "archive"]
        for i, pn in enumerate(phase_names):
            if i < phase_idx:
                bar += f"\033[92m■{RESET} "
            elif i == phase_idx:
                bar += f"\033[93m▶{RESET} "
            else:
                bar += f"{DIM}○{RESET} "

        print(f"  {BOLD}{change_id}{RESET}{elapsed}")
        print(f"    Phase: {bar}")
        print(f"    Tool calls: {d.get('tool_calls', {}).get('total', 0)}  |  "
              f"Apply iterations: {d.get('apply_iterations', 0)}  |  "
              f"Recovery attempts: {d.get('recovery_attempts', 0)}")
        print()


PHASES = ["propose", "specs", "design", "tasks", "apply", "verify", "archive"]


def display_completed(metrics: list[dict], limit: int = 10):
    """Display recent completed deliverables."""
    print(f"\n{BOLD}Completed Deliverables{RESET}")
    print_separator()

    if not metrics:
        print(f"  {DIM}No completed deliverables{RESET}")
        return

    # Show most recent first
    recent = sorted(
        metrics,
        key=lambda m: m.get("completed_at", ""),
        reverse=True,
    )[:limit]

    for m in recent:
        cid = m.get("change_id", "unknown")
        completed = m.get("completed_at", "")[:19].replace("T", " ")
        met = m.get("metrics", {})

        latency = met.get("resolution_latency_seconds", 0)
        latency_tier = classify("latency", latency)

        conf = met.get("conformance", {})
        overall = conf.get("overall", 0)
        conf_tier = classify("conformance", overall)

        failed = met.get("deliverable_failed", False)
        status = f"\033[91mFAILED{RESET}" if failed else f"\033[92mPASSED{RESET}"

        tools_total = met.get("tool_calls", {}).get("total", 0)

        print(f"  {BOLD}{cid}{RESET}  [{status}]  {DIM}{completed}{RESET}")
        tc = tier_color(latency_tier)
        print(f"    Latency: {format_duration(latency)} [{tc}{latency_tier}{RESET}]  |  "
              f"Tools: {tools_total}  |  "
              f"Iterations: {met.get('apply_iterations', 0)}")
        tc2 = tier_color(conf_tier)
        print(f"    Conformance: {overall:.2f} [{tc2}{conf_tier}{RESET}]  "
              f"(fn={conf.get('functional', 0):.2f} "
              f"cr={conf.get('correctness', 0):.2f} "
              f"cn={conf.get('constraints', 0):.2f})")
        print()


def display_aggregated(metrics: list[dict]):
    """Display aggregated stats and performance tiers."""
    print(f"\n{BOLD}Aggregated AURA Metrics{RESET}")
    print_separator()

    if not metrics:
        print(f"  {DIM}No data to aggregate{RESET}")
        return

    now = datetime.now(timezone.utc)

    # Filter by time windows
    def in_window(m, days):
        try:
            t = datetime.fromisoformat(m.get("completed_at", ""))
            return (now - t).days < days
        except ValueError:
            return False

    last_7 = [m for m in metrics if in_window(m, 7)]
    last_30 = [m for m in metrics if in_window(m, 30)]

    total_count = len(metrics)
    count_7 = len(last_7)
    count_30 = len(last_30)

    # Feature Throughput
    throughput_7 = count_7 / 7 if count_7 > 0 else 0
    throughput_30 = count_30 / 30 if count_30 > 0 else 0
    throughput_tier = classify("throughput", throughput_7)

    # Average Resolution Latency
    latencies = [m.get("metrics", {}).get("resolution_latency_seconds", 0) for m in metrics]
    avg_latency = sum(latencies) / len(latencies) if latencies else 0
    latency_tier = classify("latency", avg_latency)

    # Failure Rate
    failed_count = sum(1 for m in metrics if m.get("metrics", {}).get("deliverable_failed", False))
    failure_rate = failed_count / total_count if total_count > 0 else 0
    failure_tier = classify("failure_rate", failure_rate)

    # Recovery Efficiency (overhead = recovery_attempts / apply_iterations)
    total_iterations = sum(m.get("metrics", {}).get("apply_iterations", 0) for m in metrics)
    total_recovery = sum(m.get("metrics", {}).get("recovery_attempts", 0) for m in metrics)
    recovery_overhead = total_recovery / total_iterations if total_iterations > 0 else 0
    recovery_tier = classify("recovery", recovery_overhead)

    # Mean Conformance
    conformances = [
        m.get("metrics", {}).get("conformance", {}).get("overall", 0) for m in metrics
    ]
    mean_conformance = sum(conformances) / len(conformances) if conformances else 0
    conformance_tier = classify("conformance", mean_conformance)

    # Display
    print(f"  Total deliverables: {total_count}  |  Last 7d: {count_7}  |  Last 30d: {count_30}")
    print()

    header = f"  {'Metric':<25} {'Value':<20} {'Tier':<10}"
    print(header)
    print(f"  {'─' * 55}")

    tc = tier_color(throughput_tier)
    print(f"  {'Feature Throughput':<25} {throughput_7:.2f}/day (7d){'':<7} {tc}{throughput_tier}{RESET}")

    tc = tier_color(latency_tier)
    print(f"  {'Resolution Latency':<25} {format_duration(avg_latency):<20} {tc}{latency_tier}{RESET}")

    tc = tier_color(failure_tier)
    print(f"  {'Failure Rate':<25} {failure_rate * 100:.1f}%{'':<15} {tc}{failure_tier}{RESET}")

    tc = tier_color(recovery_tier)
    print(f"  {'Recovery Efficiency':<25} {recovery_overhead * 100:.1f}% overhead{'':<7} {tc}{recovery_tier}{RESET}")

    tc = tier_color(conformance_tier)
    print(f"  {'Spec Conformance':<25} {mean_conformance:.3f}{'':<15} {tc}{conformance_tier}{RESET}")

    print()


def display_json(active: list[dict], metrics: list[dict]):
    """Output everything as JSON."""
    print(json.dumps({
        "active_deliverables": active,
        "completed_metrics": metrics,
    }, indent=2))


def main():
    json_mode = "--json" in sys.argv

    active = load_active_deliverables()
    completed = load_completed_metrics()

    if json_mode:
        display_json(active, completed)
        return

    print(f"\n{BOLD}{'═' * 72}{RESET}")
    print(f"{BOLD}  AURA Metrics Dashboard{RESET}")
    print(f"{BOLD}{'═' * 72}{RESET}")

    display_active(active)
    display_completed(completed)
    display_aggregated(completed)

    print_separator("═")
    print()


if __name__ == "__main__":
    main()
