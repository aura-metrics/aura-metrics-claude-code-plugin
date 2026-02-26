# AURA Metrics — Hook Reference

AURA (Autonomous Unit Resolution Analytics) passively collects performance metrics for AI agent deliverables. This file is the concise reference for agents and engineers working within a project that uses AURA hooks.

## Quick Reference

### Universal commands (always available)

| Command | Action |
|---|---|
| `/aura:start <name>` | Start tracking a new deliverable |
| `/aura:next` | Advance to the next lifecycle phase |
| `/aura:ff` | Fast-forward through specs/design/tasks |
| `/aura:apply` | Jump to apply phase (tool calls counted from here) |
| `/aura:verify` | Jump to verify phase |
| `/aura:done` | Complete deliverable and emit metrics |
| `/aura:status` | Print current deliverable state |
| `/aura:cancel` | Abandon current deliverable |

### OpenSpec commands (default, no setup needed)

| Command | Action |
|---|---|
| `/opsx:propose <name>` | Start tracking |
| `/opsx:ff` | Fast-forward to tasks |
| `/opsx:continue` | Advance to next phase |
| `/opsx:apply` | Begin implementation |
| `/opsx:verify` | Begin verification |
| `/opsx:archive` | Complete deliverable |

### SpecKit commands (requires `node .claude/hooks/aura-setup.mjs speckit`)

| Command | Action |
|---|---|
| `/speckit.specify <name>` | Start tracking |
| `/speckit.plan` | Advance phase |
| `/speckit.tasks` | Advance phase |
| `/speckit.implement` | Begin implementation |
| `/speckit.checklist` | Begin verification |

Commands from different layers can be mixed. `/aura:*` commands always take priority.

## Lifecycle Phases

```
propose → specs → design → tasks → apply → verify → archive
```

- **apply** is where tool calls (Write, Edit, Bash, etc.) are counted
- **verify** is where task completion (`- [x]` in tasks.md) is read
- **archive/done** emits final metrics to `~/.aura/metrics/`

## What the Hooks Do

| Hook | Behavior |
|---|---|
| `SessionStart` | Loads active deliverable, logs to stderr |
| `UserPromptSubmit` | Matches commands, transitions phases |
| `PostToolUse` | Increments tool counters (apply phase only) |
| `Stop` | Records apply iterations or task counts |
| `SessionEnd` | No-op (state persisted on every event) |

All hooks output `{"suppressOutput": true}` — invisible to the user.

## Adapter Config

The `.aura.json` file in the project root maps commands to actions. Optional — without it, OpenSpec is the default.

```json
{
  "adapter": "speckit",
  "commands": {
    "/speckit.specify": "propose",
    "/speckit.plan": "advance",
    "/speckit.implement": "apply",
    "/speckit.checklist": "verify",
    "/aura:archive": "archive"
  },
  "changes_dir": "specs",
  "tasks_patterns": ["tasks.md"]
}
```

Valid actions: `propose`, `advance`, `fast_forward`, `apply`, `verify`, `archive`.

Setup: `node .claude/hooks/aura-setup.mjs` (interactive) or `node .claude/hooks/aura-setup.mjs speckit`.

## Conformance Score

```
overall = 0.4 × functional + 0.3 × correctness + 0.2 × constraints + 0.1 × iteration_penalty
```

- **functional** = checked tasks / total tasks in tasks.md
- **correctness** = 1.0 if verify phase completed, 0.8 otherwise
- **constraints** = 1.0 - 0.1 per recovery attempt
- **iteration_penalty** = 1.0 - 0.15 per extra apply iteration

Failed if overall < 0.5.

## Data Locations

| Path | Contents |
|---|---|
| `~/.aura/deliverables/<id>.json` | Active deliverable state (phases, tool counts) |
| `~/.aura/metrics/<id>.json` | Final metrics (emitted on completion) |

## Five Metrics

| Metric | Elite | High | Medium | Low |
|---|---|---|---|---|
| Feature Throughput | ≥3/day | ≥1/day | ≥1/week | <1/week |
| Resolution Latency | <1hr | <4hr | <1day | ≥1day |
| Failure Rate | <5% | <10% | <15% | ≥15% |
| Recovery Efficiency | <5% overhead | <10% | <20% | ≥20% |
| Spec Conformance | ≥0.95 | ≥0.85 | ≥0.70 | <0.70 |

## Files

| File | Purpose |
|---|---|
| `aura-hook.mjs` | Main hook handler (all events) |
| `aura-view.mjs` | CLI metrics dashboard (`--json` for machine output) |
| `aura-setup.mjs` | Interactive adapter setup |
| `test-aura.mjs` | Integration tests (62 tests) |
