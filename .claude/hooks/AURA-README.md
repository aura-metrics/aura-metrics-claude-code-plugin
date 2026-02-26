# AURA Metrics for Claude Code + OpenSpec

AURA (Autonomous Unit Resolution Analytics) measures AI agent performance — like DORA, but for agents instead of pipelines.

## Five Metrics

| Metric | What it measures |
|---|---|
| **Feature Throughput** | Deliverables accepted per time period |
| **Resolution Latency** | Time from spec received to deliverable accepted |
| **Deliverable Failure Rate** | % of deliverables failing spec conformance |
| **Recovery Efficiency** | Overhead spent on retries/rework |
| **Spec Conformance** | Quality score 0–1 of accepted deliverables |

## How It Works

Claude Code hooks fire automatically as you use OpenSpec commands:

```
/opsx:propose  →  Starts tracking a new deliverable
/opsx:ff       →  Fast-forwards through specs/design/tasks
/opsx:continue →  Advances to the next phase
/opsx:apply    →  Begins implementation (tool calls are counted)
/opsx:verify   →  Verification phase
/opsx:archive  →  Completes deliverable, emits final metrics
```

All tracking is invisible — hooks run in the background with `suppressOutput: true`.

## Installation

The hooks are configured in `.claude/settings.json`. No additional setup is needed — the hook script uses only Node.js built-ins (which Claude Code already requires).

Directories `~/.aura/deliverables/` and `~/.aura/metrics/` are created automatically on first use.

## Files

| File | Purpose |
|---|---|
| `.claude/hooks/aura-hook.mjs` | Main hook handler (all events) |
| `.claude/hooks/aura-view.mjs` | CLI metrics dashboard |
| `.claude/hooks/test-aura.mjs` | Integration test script |
| `.claude/settings.json` | Hook wiring configuration |

## Viewing Metrics

```bash
node .claude/hooks/aura-view.mjs
```

Shows active deliverables, recent completions, and aggregated stats with performance tier classifications (Elite/High/Medium/Low).

For JSON output:

```bash
node .claude/hooks/aura-view.mjs --json
```

## Data Storage

- Active state: `~/.aura/deliverables/<change-id>.json`
- Completed metrics: `~/.aura/metrics/<change-id>.json`

## Performance Tiers

| Metric | Elite | High | Medium | Low |
|---|---|---|---|---|
| Throughput | ≥3/day | ≥1/day | ≥1/week | <1/week |
| Latency | <1hr | <4hr | <1day | ≥1day |
| Failure Rate | <5% | <10% | <15% | ≥15% |
| Recovery | <5% overhead | <10% | <20% | ≥20% |
| Conformance | ≥0.95 | ≥0.85 | ≥0.70 | <0.70 |
