#!/usr/bin/env python3
"""
AURA Metrics Collection Hook for Claude Code.

Handles all hook events (SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd)
to passively collect AURA metrics as OpenSpec deliverables flow through their lifecycle.

Usage: python3 aura-hook.py <EventType>
Reads hook context JSON from stdin, writes hook response JSON to stdout.
"""

import json
import os
import re
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

# ── Paths ────────────────────────────────────────────────────────────────────

AURA_DIR = Path.home() / ".aura"
DELIVERABLES_DIR = AURA_DIR / "deliverables"
METRICS_DIR = AURA_DIR / "metrics"

PROJECT_DIR = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())

# ── Phase ordering ───────────────────────────────────────────────────────────

PHASES = ["propose", "specs", "design", "tasks", "apply", "verify", "archive"]

# ── Tracked tool names ───────────────────────────────────────────────────────

TRACKED_TOOLS = {"Write", "Edit", "MultiEdit", "Bash", "Read", "Grep", "Glob"}

# ── Helpers ──────────────────────────────────────────────────────────────────


def ensure_dirs():
    """Create AURA directories if they don't exist."""
    DELIVERABLES_DIR.mkdir(parents=True, exist_ok=True)
    METRICS_DIR.mkdir(parents=True, exist_ok=True)


def now_iso():
    """Return current UTC timestamp as ISO 8601 string."""
    return datetime.now(timezone.utc).isoformat()


def atomic_write_json(path: Path, data: dict):
    """Write JSON atomically via temp file + rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
        os.replace(tmp, str(path))
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def load_state(change_id: str) -> dict | None:
    """Load deliverable state file, return None if missing."""
    p = DELIVERABLES_DIR / f"{change_id}.json"
    if p.exists():
        with open(p) as f:
            return json.load(f)
    return None


def save_state(state: dict):
    """Persist deliverable state."""
    atomic_write_json(DELIVERABLES_DIR / f"{state['change_id']}.json", state)


def find_active_deliverable() -> dict | None:
    """Find the first non-archived active deliverable."""
    if not DELIVERABLES_DIR.exists():
        return None
    for p in sorted(DELIVERABLES_DIR.glob("*.json")):
        try:
            with open(p) as f:
                state = json.load(f)
            if state.get("status") not in ("archive", "completed"):
                return state
        except (json.JSONDecodeError, KeyError):
            continue
    return None


def detect_change_id_from_openspec() -> str | None:
    """Try to find an active change-id by scanning openspec/changes/."""
    changes_dir = Path(PROJECT_DIR) / "openspec" / "changes"
    if not changes_dir.is_dir():
        return None
    for d in sorted(changes_dir.iterdir()):
        if d.is_dir() and not d.name.startswith("."):
            # Check if not archived (no archived marker)
            archived_marker = d / ".archived"
            if not archived_marker.exists():
                return d.name
    return None


def new_state(change_id: str) -> dict:
    """Create a fresh deliverable state."""
    return {
        "change_id": change_id,
        "status": "propose",
        "started_at": now_iso(),
        "phases": {
            "propose": {"started_at": now_iso(), "completed_at": None},
            "specs": None,
            "design": None,
            "tasks": None,
            "apply": None,
            "verify": None,
            "archive": None,
        },
        "spec_data": {
            "requirements_count": 0,
            "tasks_count": 0,
            "tasks_completed": 0,
            "complexity": "unknown",
        },
        "tool_calls": {
            "Write": 0,
            "Edit": 0,
            "MultiEdit": 0,
            "Bash": 0,
            "Read": 0,
            "Grep": 0,
            "Glob": 0,
            "total": 0,
        },
        "apply_iterations": 0,
        "recovery_attempts": 0,
        "conformance": None,
    }


def transition_phase(state: dict, target_phase: str) -> dict:
    """Transition deliverable to a new phase, closing the current one."""
    ts = now_iso()
    current = state["status"]

    # Close current phase
    if current in state["phases"] and state["phases"][current] is not None:
        state["phases"][current]["completed_at"] = ts

    # Open target phase
    state["phases"][target_phase] = {"started_at": ts, "completed_at": None}
    state["status"] = target_phase
    return state


def fast_forward(state: dict) -> dict:
    """Transition through specs, design, tasks phases at once."""
    ts = now_iso()
    current = state["status"]

    # Close current phase
    if current in state["phases"] and state["phases"][current] is not None:
        state["phases"][current]["completed_at"] = ts

    # Mark specs, design, tasks as completed
    for phase in ["specs", "design", "tasks"]:
        state["phases"][phase] = {"started_at": ts, "completed_at": ts}

    state["status"] = "tasks"
    return state


def parse_tasks_md(change_id: str) -> tuple[int, int]:
    """Parse tasks.md to count total and completed tasks. Returns (total, completed)."""
    # Try multiple locations
    candidates = [
        Path(PROJECT_DIR) / "openspec" / "changes" / change_id / "tasks.md",
        Path(PROJECT_DIR) / "openspec" / "changes" / change_id / "tasks" / "tasks.md",
    ]
    for tasks_path in candidates:
        if tasks_path.exists():
            content = tasks_path.read_text()
            checked = len(re.findall(r"- \[x\]", content, re.IGNORECASE))
            unchecked = len(re.findall(r"- \[ \]", content))
            total = checked + unchecked
            return total, checked
    return 0, 0


def compute_conformance(state: dict) -> dict:
    """Compute conformance scores for a completed deliverable."""
    total, completed = parse_tasks_md(state["change_id"])

    # Update spec_data
    state["spec_data"]["tasks_count"] = total
    state["spec_data"]["tasks_completed"] = completed

    # Functional completeness
    functional = completed / total if total > 0 else 1.0

    # Correctness: 1.0 if verify completed, 0.8 if skipped
    verify_phase = state["phases"].get("verify")
    if verify_phase and verify_phase.get("completed_at"):
        correctness = 1.0
    else:
        correctness = 0.8

    # Constraints: 1.0 minus 0.1 per recovery attempt (floor 0.0)
    constraints = max(0.0, 1.0 - 0.1 * state.get("recovery_attempts", 0))

    # Iteration penalty: 1.0 for first, decays by 0.15 per additional
    iterations = max(1, state.get("apply_iterations", 1))
    iteration_penalty = max(0.0, 1.0 - 0.15 * (iterations - 1))

    # Overall
    overall = (0.4 * functional) + (0.3 * correctness) + (0.2 * constraints) + (0.1 * iteration_penalty)

    return {
        "functional": round(functional, 4),
        "correctness": round(correctness, 4),
        "constraints": round(constraints, 4),
        "overall": round(overall, 4),
    }


def compute_phase_duration_seconds(phase_data: dict | None) -> int | None:
    """Compute duration in seconds for a phase."""
    if not phase_data or not phase_data.get("started_at") or not phase_data.get("completed_at"):
        return None
    try:
        start = datetime.fromisoformat(phase_data["started_at"])
        end = datetime.fromisoformat(phase_data["completed_at"])
        return max(0, int((end - start).total_seconds()))
    except (ValueError, TypeError):
        return None


def emit_metrics(state: dict):
    """Compute and write final AURA metrics for a completed deliverable."""
    conformance = compute_conformance(state)
    state["conformance"] = conformance

    # Compute phase durations
    phase_durations = {}
    for phase_name in PHASES:
        dur = compute_phase_duration_seconds(state["phases"].get(phase_name))
        if dur is not None:
            phase_durations[phase_name] = dur

    # Resolution latency
    try:
        started = datetime.fromisoformat(state["started_at"])
        completed = datetime.now(timezone.utc)
        resolution_latency = max(0, int((completed - started).total_seconds()))
    except (ValueError, TypeError):
        resolution_latency = sum(phase_durations.values())

    # Determine if deliverable failed
    deliverable_failed = conformance["overall"] < 0.5

    metrics_record = {
        "change_id": state["change_id"],
        "completed_at": now_iso(),
        "metrics": {
            "resolution_latency_seconds": resolution_latency,
            "phase_durations": phase_durations,
            "tool_calls": dict(state.get("tool_calls", {})),
            "apply_iterations": state.get("apply_iterations", 0),
            "recovery_attempts": state.get("recovery_attempts", 0),
            "tasks_completed": state["spec_data"].get("tasks_completed", 0),
            "tasks_total": state["spec_data"].get("tasks_count", 0),
            "conformance": conformance,
            "deliverable_failed": deliverable_failed,
        },
    }

    atomic_write_json(METRICS_DIR / f"{state['change_id']}.json", metrics_record)
    return metrics_record


def output_suppress():
    """Output JSON telling Claude Code to suppress hook output."""
    print(json.dumps({"suppressOutput": True}))


# ── Event Handlers ───────────────────────────────────────────────────────────


def handle_session_start(hook_input: dict):
    """On SessionStart: check for active deliverables."""
    ensure_dirs()
    active = find_active_deliverable()
    if active:
        print(
            f"AURA: tracking deliverable '{active['change_id']}' (phase: {active['status']})",
            file=sys.stderr,
        )


def handle_user_prompt_submit(hook_input: dict):
    """On UserPromptSubmit: detect /opsx:* commands and transition phases."""
    ensure_dirs()

    # Extract user prompt text
    prompt = hook_input.get("prompt", "")
    if not prompt:
        # Try nested structure
        prompt = hook_input.get("message", {}).get("content", "")
    if not prompt:
        output_suppress()
        return

    # Match /opsx: commands
    match = re.search(
        r"/opsx:(propose|new|ff|continue|apply|verify|archive)(?:\s+(\S+))?",
        prompt,
    )
    if not match:
        output_suppress()
        return

    command = match.group(1)
    change_id = match.group(2)

    # Resolve change_id if not provided
    if not change_id:
        active = find_active_deliverable()
        if active:
            change_id = active["change_id"]
        else:
            change_id = detect_change_id_from_openspec()
        if not change_id:
            output_suppress()
            return

    # Handle each command
    if command in ("propose", "new"):
        state = new_state(change_id)
        save_state(state)

    elif command == "ff":
        state = load_state(change_id) or find_active_deliverable()
        if state:
            state = fast_forward(state)
            save_state(state)

    elif command == "continue":
        state = load_state(change_id) or find_active_deliverable()
        if state:
            current_idx = PHASES.index(state["status"]) if state["status"] in PHASES else 0
            if current_idx < len(PHASES) - 1:
                next_phase = PHASES[current_idx + 1]
                state = transition_phase(state, next_phase)
                save_state(state)

    elif command == "apply":
        state = load_state(change_id) or find_active_deliverable()
        if state:
            state = transition_phase(state, "apply")
            # Reset tool counters for this apply phase
            for key in state["tool_calls"]:
                state["tool_calls"][key] = 0
            save_state(state)

    elif command == "verify":
        state = load_state(change_id) or find_active_deliverable()
        if state:
            state = transition_phase(state, "verify")
            save_state(state)

    elif command == "archive":
        state = load_state(change_id) or find_active_deliverable()
        if state:
            state = transition_phase(state, "archive")
            state["phases"]["archive"]["completed_at"] = now_iso()
            state["status"] = "completed"
            emit_metrics(state)
            save_state(state)

    output_suppress()


def handle_post_tool_use(hook_input: dict):
    """On PostToolUse: increment tool call counters during apply phase."""
    ensure_dirs()

    tool_name = hook_input.get("tool_name", "")
    if not tool_name:
        return

    active = find_active_deliverable()
    if not active or active.get("status") != "apply":
        return

    if tool_name in TRACKED_TOOLS:
        active["tool_calls"][tool_name] = active["tool_calls"].get(tool_name, 0) + 1
    active["tool_calls"]["total"] = active["tool_calls"].get("total", 0) + 1
    save_state(active)


def handle_stop(hook_input: dict):
    """On Stop: increment apply_iterations or score conformance."""
    ensure_dirs()

    active = find_active_deliverable()
    if not active:
        return

    if active.get("status") == "apply":
        active["apply_iterations"] = active.get("apply_iterations", 0) + 1
        save_state(active)

    elif active.get("status") == "verify":
        total, completed = parse_tasks_md(active["change_id"])
        active["spec_data"]["tasks_count"] = total
        active["spec_data"]["tasks_completed"] = completed
        save_state(active)


def handle_session_end(hook_input: dict):
    """On SessionEnd: safety-net persist (state should already be saved)."""
    # State is persisted on every event, nothing extra needed.
    pass


# ── Main ─────────────────────────────────────────────────────────────────────


def main():
    if len(sys.argv) < 2:
        print("Usage: aura-hook.py <EventType>", file=sys.stderr)
        sys.exit(0)

    event_type = sys.argv[1]

    # Read stdin (hook input JSON)
    try:
        raw = sys.stdin.read()
        hook_input = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, ValueError):
        hook_input = {}

    handlers = {
        "SessionStart": handle_session_start,
        "UserPromptSubmit": handle_user_prompt_submit,
        "PostToolUse": handle_post_tool_use,
        "Stop": handle_stop,
        "SessionEnd": handle_session_end,
    }

    handler = handlers.get(event_type)
    if handler:
        try:
            handler(hook_input)
        except Exception as e:
            print(f"AURA hook error ({event_type}): {e}", file=sys.stderr)

    # Always exit 0 — never block user actions
    sys.exit(0)


if __name__ == "__main__":
    main()
