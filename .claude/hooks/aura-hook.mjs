#!/usr/bin/env node
/**
 * AURA Metrics Collection Hook for Claude Code.
 *
 * Handles all hook events (SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd)
 * to passively collect AURA metrics as spec-driven deliverables flow through their lifecycle.
 *
 * Supports multiple spec frameworks (OpenSpec, SpecKit, custom) via .aura.json adapter config.
 *
 * Usage: node aura-hook.mjs <EventType>
 * Reads hook context JSON from stdin, writes hook response JSON to stdout.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync, unlinkSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { randomBytes } from "crypto";

// ── Paths ───────────────────────────────────────────────────────────────────

const AURA_DIR = join(homedir(), ".aura");
const DELIVERABLES_DIR = join(AURA_DIR, "deliverables");
const METRICS_DIR = join(AURA_DIR, "metrics");
const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// ── Phase ordering ──────────────────────────────────────────────────────────

const PHASES = ["propose", "specs", "design", "tasks", "apply", "verify", "archive"];

// ── Tracked tool names ──────────────────────────────────────────────────────

const TRACKED_TOOLS = new Set(["Write", "Edit", "MultiEdit", "Bash", "Read", "Grep", "Glob"]);

// ── Default adapter (OpenSpec) ──────────────────────────────────────────────

const DEFAULT_ADAPTER = {
  adapter: "openspec",
  commands: {
    "/opsx:propose": "propose",
    "/opsx:new": "propose",
    "/opsx:ff": "fast_forward",
    "/opsx:continue": "advance",
    "/opsx:apply": "apply",
    "/opsx:verify": "verify",
    "/opsx:archive": "archive",
  },
  changes_dir: "openspec/changes",
  tasks_patterns: ["tasks.md", "tasks/tasks.md"],
};

// ── Load adapter config ─────────────────────────────────────────────────────

function loadAdapterConfig() {
  const configPath = join(PROJECT_DIR, ".aura.json");
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      if (config.commands && config.changes_dir) return config;
    }
  } catch { /* fall through */ }
  return DEFAULT_ADAPTER;
}

const ADAPTER = loadAdapterConfig();

// ── Helpers ─────────────────────────────────────────────────────────────────

function ensureDirs() {
  mkdirSync(DELIVERABLES_DIR, { recursive: true });
  mkdirSync(METRICS_DIR, { recursive: true });
}

function nowISO() {
  return new Date().toISOString();
}

function atomicWriteJSON(filePath, data) {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.tmp-${randomBytes(6).toString("hex")}.json`);
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
    renameSync(tmp, filePath);
  } catch (e) {
    try { unlinkSync(tmp); } catch (_) { /* ignore */ }
    throw e;
  }
}

function loadState(changeId) {
  const p = join(DELIVERABLES_DIR, `${changeId}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function saveState(state) {
  atomicWriteJSON(join(DELIVERABLES_DIR, `${state.change_id}.json`), state);
}

function findActiveDeliverable() {
  if (!existsSync(DELIVERABLES_DIR)) return null;
  const files = readdirSync(DELIVERABLES_DIR).filter(f => f.endsWith(".json")).sort();
  for (const f of files) {
    try {
      const state = JSON.parse(readFileSync(join(DELIVERABLES_DIR, f), "utf8"));
      if (state.status !== "archive" && state.status !== "completed") return state;
    } catch {
      continue;
    }
  }
  return null;
}

function detectChangeIdFromSpec() {
  const changesDir = join(PROJECT_DIR, ADAPTER.changes_dir);
  try {
    if (!statSync(changesDir).isDirectory()) return null;
  } catch {
    return null;
  }
  const dirs = readdirSync(changesDir).filter(d => {
    if (d.startsWith(".")) return false;
    try { return statSync(join(changesDir, d)).isDirectory(); } catch { return false; }
  }).sort();
  for (const d of dirs) {
    if (!existsSync(join(changesDir, d, ".archived"))) return d;
  }
  return null;
}

function newState(changeId) {
  return {
    change_id: changeId,
    adapter: ADAPTER.adapter,
    status: "propose",
    started_at: nowISO(),
    phases: {
      propose: { started_at: nowISO(), completed_at: null },
      specs: null,
      design: null,
      tasks: null,
      apply: null,
      verify: null,
      archive: null,
    },
    spec_data: {
      requirements_count: 0,
      tasks_count: 0,
      tasks_completed: 0,
      complexity: "unknown",
    },
    tool_calls: {
      Write: 0, Edit: 0, MultiEdit: 0, Bash: 0,
      Read: 0, Grep: 0, Glob: 0, total: 0,
    },
    apply_iterations: 0,
    recovery_attempts: 0,
    conformance: null,
  };
}

function transitionPhase(state, targetPhase) {
  const ts = nowISO();
  const current = state.status;
  if (current in state.phases && state.phases[current] != null) {
    state.phases[current].completed_at = ts;
  }
  state.phases[targetPhase] = { started_at: ts, completed_at: null };
  state.status = targetPhase;
  return state;
}

function fastForward(state) {
  const ts = nowISO();
  const current = state.status;
  if (current in state.phases && state.phases[current] != null) {
    state.phases[current].completed_at = ts;
  }
  for (const phase of ["specs", "design", "tasks"]) {
    state.phases[phase] = { started_at: ts, completed_at: ts };
  }
  state.status = "tasks";
  return state;
}

function parseTasksMd(changeId) {
  const patterns = ADAPTER.tasks_patterns || ["tasks.md"];
  const candidates = patterns.map(p => join(PROJECT_DIR, ADAPTER.changes_dir, changeId, p));
  for (const p of candidates) {
    try {
      const content = readFileSync(p, "utf8");
      const checked = (content.match(/- \[x\]/gi) || []).length;
      const unchecked = (content.match(/- \[ \]/g) || []).length;
      return { total: checked + unchecked, completed: checked };
    } catch {
      continue;
    }
  }
  return { total: 0, completed: 0 };
}

function computeConformance(state) {
  const { total, completed } = parseTasksMd(state.change_id);
  state.spec_data.tasks_count = total;
  state.spec_data.tasks_completed = completed;

  const functional = total > 0 ? completed / total : 1.0;
  const verifyPhase = state.phases.verify;
  const correctness = (verifyPhase && verifyPhase.completed_at) ? 1.0 : 0.8;
  const constraints = Math.max(0.0, 1.0 - 0.1 * (state.recovery_attempts || 0));
  const iterations = Math.max(1, state.apply_iterations || 1);
  const iterationPenalty = Math.max(0.0, 1.0 - 0.15 * (iterations - 1));
  const overall = 0.4 * functional + 0.3 * correctness + 0.2 * constraints + 0.1 * iterationPenalty;

  return {
    functional: Math.round(functional * 10000) / 10000,
    correctness: Math.round(correctness * 10000) / 10000,
    constraints: Math.round(constraints * 10000) / 10000,
    overall: Math.round(overall * 10000) / 10000,
  };
}

function computePhaseDuration(phaseData) {
  if (!phaseData || !phaseData.started_at || !phaseData.completed_at) return null;
  try {
    const start = new Date(phaseData.started_at);
    const end = new Date(phaseData.completed_at);
    return Math.max(0, Math.round((end - start) / 1000));
  } catch {
    return null;
  }
}

function emitMetrics(state) {
  const conformance = computeConformance(state);
  state.conformance = conformance;

  const phaseDurations = {};
  for (const phaseName of PHASES) {
    const dur = computePhaseDuration(state.phases[phaseName]);
    if (dur != null) phaseDurations[phaseName] = dur;
  }

  let resolutionLatency;
  try {
    const started = new Date(state.started_at);
    resolutionLatency = Math.max(0, Math.round((Date.now() - started.getTime()) / 1000));
  } catch {
    resolutionLatency = Object.values(phaseDurations).reduce((a, b) => a + b, 0);
  }

  const deliverableFailed = conformance.overall < 0.5;

  const record = {
    change_id: state.change_id,
    adapter: state.adapter || ADAPTER.adapter,
    completed_at: nowISO(),
    metrics: {
      resolution_latency_seconds: resolutionLatency,
      phase_durations: phaseDurations,
      tool_calls: { ...state.tool_calls },
      apply_iterations: state.apply_iterations || 0,
      recovery_attempts: state.recovery_attempts || 0,
      tasks_completed: state.spec_data.tasks_completed || 0,
      tasks_total: state.spec_data.tasks_count || 0,
      conformance,
      deliverable_failed: deliverableFailed,
    },
  };

  atomicWriteJSON(join(METRICS_DIR, `${state.change_id}.json`), record);
  return record;
}

function outputSuppress() {
  process.stdout.write(JSON.stringify({ suppressOutput: true }) + "\n");
}

// ── Command matching ────────────────────────────────────────────────────────

/**
 * Match a user prompt against the adapter's command map.
 * Returns { action, changeId } or null if no match.
 */
function matchCommand(prompt) {
  for (const [trigger, action] of Object.entries(ADAPTER.commands)) {
    // Build a regex: escape the trigger, then allow an optional trailing argument
    const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|\\s)${escaped}(?:\\s+(\\S+))?(?:\\s|$)`);
    const m = prompt.match(re);
    if (m) {
      return { action, changeId: m[1] || null };
    }
  }
  return null;
}

// ── Event Handlers ──────────────────────────────────────────────────────────

function handleSessionStart(_input) {
  ensureDirs();
  const active = findActiveDeliverable();
  if (active) {
    process.stderr.write(`AURA: tracking deliverable '${active.change_id}' (phase: ${active.status})\n`);
  }
}

function handleUserPromptSubmit(input) {
  ensureDirs();

  const prompt = input.prompt || (input.message && input.message.content) || "";
  if (!prompt) { outputSuppress(); return; }

  const matched = matchCommand(prompt);
  if (!matched) { outputSuppress(); return; }

  const { action } = matched;
  let changeId = matched.changeId;

  if (!changeId) {
    const active = findActiveDeliverable();
    if (active) changeId = active.change_id;
    else changeId = detectChangeIdFromSpec();
    if (!changeId) { outputSuppress(); return; }
  }

  if (action === "propose") {
    saveState(newState(changeId));
  } else if (action === "fast_forward") {
    let state = loadState(changeId) || findActiveDeliverable();
    if (state) { state = fastForward(state); saveState(state); }
  } else if (action === "advance") {
    let state = loadState(changeId) || findActiveDeliverable();
    if (state) {
      const idx = PHASES.indexOf(state.status);
      if (idx >= 0 && idx < PHASES.length - 1) {
        state = transitionPhase(state, PHASES[idx + 1]);
        saveState(state);
      }
    }
  } else if (action === "apply") {
    let state = loadState(changeId) || findActiveDeliverable();
    if (state) {
      state = transitionPhase(state, "apply");
      for (const key of Object.keys(state.tool_calls)) state.tool_calls[key] = 0;
      saveState(state);
    }
  } else if (action === "verify") {
    let state = loadState(changeId) || findActiveDeliverable();
    if (state) { state = transitionPhase(state, "verify"); saveState(state); }
  } else if (action === "archive") {
    let state = loadState(changeId) || findActiveDeliverable();
    if (state) {
      state = transitionPhase(state, "archive");
      state.phases.archive.completed_at = nowISO();
      state.status = "completed";
      emitMetrics(state);
      saveState(state);
    }
  }

  outputSuppress();
}

function handlePostToolUse(input) {
  ensureDirs();
  const toolName = input.tool_name || "";
  if (!toolName) return;

  const active = findActiveDeliverable();
  if (!active || active.status !== "apply") return;

  if (TRACKED_TOOLS.has(toolName)) {
    active.tool_calls[toolName] = (active.tool_calls[toolName] || 0) + 1;
  }
  active.tool_calls.total = (active.tool_calls.total || 0) + 1;
  saveState(active);
}

function handleStop(_input) {
  ensureDirs();
  const active = findActiveDeliverable();
  if (!active) return;

  if (active.status === "apply") {
    active.apply_iterations = (active.apply_iterations || 0) + 1;
    saveState(active);
  } else if (active.status === "verify") {
    const { total, completed } = parseTasksMd(active.change_id);
    active.spec_data.tasks_count = total;
    active.spec_data.tasks_completed = completed;
    saveState(active);
  }
}

function handleSessionEnd(_input) {
  // State is persisted on every event — nothing extra needed.
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const eventType = process.argv[2];
  if (!eventType) {
    process.stderr.write("Usage: aura-hook.mjs <EventType>\n");
    process.exit(0);
  }

  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    // stdin may be empty or unavailable
  }

  let hookInput = {};
  try {
    if (raw.trim()) hookInput = JSON.parse(raw);
  } catch {
    // malformed JSON — proceed with empty object
  }

  const handlers = {
    SessionStart: handleSessionStart,
    UserPromptSubmit: handleUserPromptSubmit,
    PostToolUse: handlePostToolUse,
    Stop: handleStop,
    SessionEnd: handleSessionEnd,
  };

  const handler = handlers[eventType];
  if (handler) {
    try {
      handler(hookInput);
    } catch (e) {
      process.stderr.write(`AURA hook error (${eventType}): ${e.message}\n`);
    }
  }

  process.exit(0);
}

main();
