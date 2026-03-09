# AURA Metrics — Claude Code Plugin

[![Tests](https://github.com/aura-metrics/aura-metrics-claude-code-plugin/actions/workflows/test.yml/badge.svg)](https://github.com/aura-metrics/aura-metrics-claude-code-plugin/actions/workflows/test.yml)

Passive metrics collection for AI agent performance using [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks). AURA is like DORA metrics, but for AI agents instead of CI/CD pipelines.

## What It Measures

| Metric | What it measures | Elite | High | Medium | Low |
|---|---|---|---|---|---|
| **Feature Frequency** | Deliverables completed per time period | ≥3/day | ≥1/day | ≥1/week | <1/week |
| **Feature Lead Time** | Time from start to deliverable accepted | <1hr | <4hr | <1day | ≥1day |
| **Human Intervention Rate** | % requiring human takeover or abandoned | <5% | <10% | <15% | ≥15% |
| **Recovery Efficiency** | Overhead spent on retries/rework | <5% | <10% | <20% | ≥20% |

## Prerequisites

- **Node.js 18+** — Claude Code already requires Node.js, so every user has it. No additional runtime or dependencies needed. Zero `npm install`.

## Installation

### Quick start (copy into existing project)

```bash
git clone https://github.com/aura-metrics/aura-metrics-claude-code-plugin.git
cp -r aura-metrics-claude-code-plugin/.claude /path/to/your/project/.claude
```

If your project already has a `.claude/` directory, merge the hooks into your existing `settings.json` (see [Hook Wiring](#hook-wiring) below).

### Choose your spec framework

AURA works with any spec-driven workflow. Pick your setup:

**Option A — No framework (universal commands only):**
No config needed. Just use `/aura:*` commands directly.

**Option B — OpenSpec (default adapter):**
Works out of the box. No setup step required.

**Option C — SpecKit:**
```bash
node .claude/hooks/aura-setup.mjs speckit
```

**Option D — Custom framework:**
```bash
node .claude/hooks/aura-setup.mjs
```
This runs an interactive setup that writes a `.aura.json` config to your project root.

### That's it

The directories `~/.aura/deliverables/` and `~/.aura/metrics/` are created automatically on first use.

## How It Works

### The deliverable lifecycle

AURA tracks deliverables through seven phases:

```
propose → specs → design → tasks → apply → verify → archive
```

- **propose** — A new deliverable is being scoped
- **specs** — Requirements are being written
- **design** — Technical design is underway
- **tasks** — Task breakdown is happening
- **apply** — Implementation (tool calls like Write, Edit, Bash are counted here)
- **verify** — Testing and validation
- **archive** — Done. Final metrics are emitted.

You don't have to use all phases. `/aura:ff` fast-forwards through specs/design/tasks in one step. `/aura:apply` jumps straight to the apply phase.

### Commands

There are three layers of commands. They all share the same underlying state.

#### Universal `/aura:*` commands (always available)

These work with any framework, or standalone with no framework at all:

```
/aura:start <name>  →  Start tracking a new deliverable
/aura:next          →  Advance to the next phase
/aura:ff            →  Fast-forward through specs/design/tasks
/aura:apply         →  Jump to apply phase (tool calls counted)
/aura:verify        →  Jump to verify phase
/aura:done          →  Complete deliverable, emit final metrics
/aura:status        →  Print current deliverable state to stderr
/aura:cancel        →  Abandon current deliverable (no metrics emitted)
```

#### OpenSpec commands (default adapter)

```
/opsx:propose <name>  →  Start tracking (same as /aura:start)
/opsx:new <name>      →  Alias for propose
/opsx:ff              →  Fast-forward to tasks
/opsx:continue        →  Advance to next phase
/opsx:apply           →  Begin implementation
/opsx:verify          →  Begin verification
/opsx:archive         →  Complete deliverable
```

#### SpecKit commands (requires setup)

```
/speckit.specify <name>  →  Start tracking
/speckit.plan            →  Advance phase
/speckit.tasks           →  Advance phase
/speckit.implement       →  Begin implementation
/speckit.checklist       →  Begin verification
/speckit.analyze         →  Begin verification (alternative)
```

Commands from different layers can be mixed freely. For example, start with `/speckit.specify`, then use `/aura:done` to complete.

### What the hooks do

| Hook Event | When it fires | What AURA does |
|---|---|---|
| `SessionStart` | Claude Code session begins | Loads any in-progress deliverable, logs to stderr |
| `UserPromptSubmit` | User sends a prompt | Matches `/aura:*` and adapter commands, transitions phases |
| `PostToolUse` | After Write, Edit, Bash, etc. | Increments tool call counters (only during `apply` phase) |
| `Stop` | Agent stops responding | Records apply iterations and task completion counts |
| `SessionEnd` | Session ends | No-op (state is persisted on every event) |

All hooks output `{"suppressOutput": true}` so they're invisible to the user.

## Example Workflows

### Standalone (no spec framework)

```
You:    /aura:start add-user-auth
        ... Claude works on the feature ...
You:    /aura:apply
        ... Claude writes code (tool calls are tracked) ...
You:    /aura:verify
        ... Claude runs tests ...
You:    /aura:done
        → Metrics emitted to ~/.aura/metrics/add-user-auth.json
```

### With OpenSpec

```
You:    /opsx:propose payment-flow
You:    /opsx:ff
You:    /opsx:apply
        ... Claude implements ...
You:    /opsx:verify
You:    /opsx:archive
        → Metrics emitted
```

### Quick one-shot

```
You:    /aura:start fix-bug-123
You:    /aura:ff
You:    /aura:apply
        ... Claude fixes the bug ...
You:    /aura:done
```

## Viewing Metrics

### Dashboard

```bash
node .claude/hooks/aura-view.mjs
```

Displays active deliverables with phase progress bars, recent completions with lead time and intervention counts, and aggregated stats with Elite/High/Medium/Low tier ratings.

### JSON output

```bash
node .claude/hooks/aura-view.mjs --json
```

Returns `{ active_deliverables: [...], completed_metrics: [...] }` for programmatic consumption.

## Adapter Configuration

The `.aura.json` file in your project root maps spec-framework commands to AURA lifecycle actions. It's optional — without it, the OpenSpec adapter is used by default.

### Format

```json
{
  "adapter": "speckit",
  "commands": {
    "/speckit.specify": "propose",
    "/speckit.plan": "advance",
    "/speckit.tasks": "advance",
    "/speckit.implement": "apply",
    "/speckit.checklist": "verify",
    "/aura:archive": "archive"
  },
  "changes_dir": "specs",
  "tasks_patterns": ["tasks.md"]
}
```

### Fields

| Field | Description |
|---|---|
| `adapter` | Name for this adapter (shown in metrics output) |
| `commands` | Map of slash command → action. Actions: `propose`, `advance`, `fast_forward`, `apply`, `verify`, `archive` |
| `changes_dir` | Directory containing per-deliverable subdirectories (relative to project root) |
| `tasks_patterns` | File patterns to search for task checkboxes within each deliverable directory |

### Creating a custom adapter

```bash
node .claude/hooks/aura-setup.mjs
```

The interactive setup walks you through defining commands and paths. You can also write `.aura.json` by hand.

## Data Storage

All state is stored under `~/.aura/`:

```
~/.aura/
  deliverables/          # Active and completed deliverable state
    my-feature.json      # Phase timestamps, tool counts, spec data
    other-feature.json
  metrics/               # Final metrics (emitted on completion)
    my-feature.json      # Lead time, human interventions, tool stats
```

Metrics files are written atomically (write to temp, then rename) to prevent corruption.

### Deliverable state format

```json
{
  "change_id": "my-feature",
  "adapter": "openspec",
  "status": "apply",
  "started_at": "2025-01-15T10:00:00.000Z",
  "phases": {
    "propose": { "started_at": "...", "completed_at": "..." },
    "apply": { "started_at": "...", "completed_at": null }
  },
  "tool_calls": { "Write": 3, "Edit": 1, "Bash": 2, "total": 8 },
  "apply_iterations": 1,
  "recovery_attempts": 0,
  "spec_data": { "tasks_count": 5, "tasks_completed": 3 }
}
```

### Metrics output format

```json
{
  "change_id": "my-feature",
  "adapter": "openspec",
  "completed_at": "2025-01-15T11:30:00.000Z",
  "metrics": {
    "resolution_latency_seconds": 5400,
    "phase_durations": { "propose": 60, "apply": 4800, "verify": 300 },
    "tool_calls": { "Write": 3, "Edit": 1, "Bash": 2, "total": 8 },
    "apply_iterations": 1,
    "recovery_attempts": 0,
    "tasks_completed": 3,
    "tasks_total": 5,
    "deliverable_failed": false,
    "human_interventions": 0
  }
}
```

## Hook Wiring

If you already have a `.claude/settings.json`, merge these hooks into your existing config:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/aura-hook.mjs UserPromptSubmit",
            "timeout": 5
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit|Bash|Read|Grep|Glob",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/aura-hook.mjs PostToolUse",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/aura-hook.mjs Stop",
            "timeout": 5
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/aura-hook.mjs SessionStart",
            "timeout": 5
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/aura-hook.mjs SessionEnd",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

## Files

| File | Purpose |
|---|---|
| `.claude/hooks/aura-hook.mjs` | Main hook handler — all event processing |
| `.claude/hooks/aura-view.mjs` | CLI metrics dashboard |
| `.claude/hooks/aura-setup.mjs` | Interactive adapter setup command |
| `.claude/hooks/test-aura.mjs` | Integration tests (62 tests) |
| `.claude/hooks/AURA-README.md` | Concise hook reference for agents |
| `.claude/settings.json` | Hook wiring configuration |
| `.aura.json` | Adapter config (project root, created by setup, optional) |

## Running Tests

```bash
node .claude/hooks/test-aura.mjs
```

Tests use isolated temp directories and a fake `$HOME` — no state is written to your real `~/.aura/`. Covers OpenSpec, SpecKit, universal commands, adapter fallback, and command coexistence.

## Architecture

```
User prompt → Claude Code Hook System → aura-hook.mjs
                                            │
                                  ┌─────────┴──────────┐
                                  │  matchCommand()     │
                                  │  /aura:* checked    │
                                  │  first, then        │
                                  │  adapter commands    │
                                  └─────────┬──────────┘
                                            │
                              ┌─────────────┼─────────────┐
                              │             │             │
                         propose/new    apply/verify   archive/done
                              │             │             │
                         newState()    transitionPhase()  emitMetrics()
                              │             │             │
                              └─────────────┼─────────────┘
                                            │
                                 ~/.aura/deliverables/*.json
                                 ~/.aura/metrics/*.json
```

The adapter config (`.aura.json`) is loaded once at startup. Universal `/aura:*` commands are hardcoded and always available. Adapter commands are loaded from config (or the OpenSpec default). Both share the same state files and lifecycle logic.

## License

MIT
