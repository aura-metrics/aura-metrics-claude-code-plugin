# AURA Metrics — Claude Code Plugin

[![Tests](https://github.com/aura-metrics/aura-metrics-claude-code-plugin/actions/workflows/test.yml/badge.svg)](https://github.com/aura-metrics/aura-metrics-claude-code-plugin/actions/workflows/test.yml)

Passive metrics collection for AI agent performance using [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks). AURA (Autonomous Unit Resolution Analytics) is like DORA metrics, but for AI agents instead of CI/CD pipelines.

## Metrics

| Metric | What it measures |
|---|---|
| **Feature Throughput** | Deliverables accepted per time period |
| **Resolution Latency** | Time from spec received to deliverable accepted |
| **Deliverable Failure Rate** | % of deliverables that fail spec conformance |
| **Recovery Efficiency** | Overhead spent on retries/rework |
| **Spec Conformance** | Quality score 0–1 of accepted deliverables |

## How It Works

Claude Code hooks observe [OpenSpec](https://github.com/openspec) slash commands and automatically record timestamps, tool usage, and conformance scores — all in the background with zero friction.

```
/opsx:propose  →  Starts tracking a new deliverable
/opsx:ff       →  Fast-forwards through specs/design/tasks
/opsx:continue →  Advances to the next phase
/opsx:apply    →  Begins implementation (tool calls are counted)
/opsx:verify   →  Verification phase
/opsx:archive  →  Completes deliverable, emits final metrics
```

Hook events used:

| Hook Event | Action |
|---|---|
| `SessionStart` | Load any in-progress deliverable |
| `UserPromptSubmit` | Detect `/opsx:*` commands, transition phases |
| `PostToolUse` | Count tool calls during `apply` phase |
| `Stop` | Record iteration completions |
| `SessionEnd` | Persist state |

## Installation

1. Clone this repo into your project (or copy the `.claude/` directory):

```bash
git clone https://github.com/aura-metrics/aura-metrics-claude-code-plugin.git
cp -r aura-metrics-claude-code-plugin/.claude /path/to/your/project/.claude
```

2. That's it. No dependencies beyond Python 3.8+ (standard library only).

The directories `~/.aura/deliverables/` and `~/.aura/metrics/` are created automatically on first use.

## Viewing Metrics

```bash
python3 .claude/hooks/aura-view.py
```

Displays active deliverables, recent completions, and aggregated stats with performance tier ratings:

| Metric | Elite | High | Medium | Low |
|---|---|---|---|---|
| Throughput | ≥3/day | ≥1/day | ≥1/week | <1/week |
| Latency | <1hr | <4hr | <1day | ≥1day |
| Failure Rate | <5% | <10% | <15% | ≥15% |
| Recovery | <5% overhead | <10% | <20% | ≥20% |
| Conformance | ≥0.95 | ≥0.85 | ≥0.70 | <0.70 |

For machine-readable output: `python3 .claude/hooks/aura-view.py --json`

## Data Storage

- Active deliverable state: `~/.aura/deliverables/<change-id>.json`
- Completed metrics: `~/.aura/metrics/<change-id>.json`

## Files

| File | Purpose |
|---|---|
| `.claude/hooks/aura-hook.py` | Main hook handler (all events) |
| `.claude/hooks/aura-view.py` | CLI metrics dashboard |
| `.claude/hooks/test-aura.sh` | Integration test script |
| `.claude/hooks/AURA-README.md` | Hook-specific documentation |
| `.claude/settings.json` | Hook wiring configuration |

## Running Tests

```bash
bash .claude/hooks/test-aura.sh
```

Tests use isolated temp directories — no state is written to your real `~/.aura/`.

## License

MIT
