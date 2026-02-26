# AURA Metrics for Claude Code

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

Claude Code hooks fire automatically as you use spec-framework commands. Supports OpenSpec, SpecKit, and custom adapters.

**OpenSpec** (default):
```
/opsx:propose → /opsx:ff → /opsx:apply → /opsx:verify → /opsx:archive
```

**SpecKit**:
```
/speckit.specify → /speckit.plan → /speckit.tasks → /speckit.implement → /speckit.checklist → /aura:archive
```

All tracking is invisible — hooks run in the background with `suppressOutput: true`.

## Installation

The hooks are configured in `.claude/settings.json`. For OpenSpec, no additional setup is needed.

For other frameworks, run setup:
```bash
node .claude/hooks/aura-setup.mjs speckit   # SpecKit
node .claude/hooks/aura-setup.mjs           # interactive (custom)
```

This writes a `.aura.json` config to your project root. The hook script uses only Node.js built-ins (which Claude Code already requires).

Directories `~/.aura/deliverables/` and `~/.aura/metrics/` are created automatically on first use.

## Files

| File | Purpose |
|---|---|
| `.claude/hooks/aura-hook.mjs` | Main hook handler (all events) |
| `.claude/hooks/aura-view.mjs` | CLI metrics dashboard |
| `.claude/hooks/aura-setup.mjs` | Adapter setup command |
| `.claude/hooks/test-aura.mjs` | Integration test script |
| `.claude/settings.json` | Hook wiring configuration |
| `.aura.json` | Adapter config (project root, created by setup) |

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
