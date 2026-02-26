#!/usr/bin/env node
/**
 * Integration tests for AURA metrics hooks.
 * Simulates a full OpenSpec deliverable lifecycle and verifies metrics output.
 */

import { execSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HOOK = join(__dirname, "aura-hook.mjs");
const VIEW = join(__dirname, "aura-view.mjs");

// Create isolated temp dirs so real ~/.aura is never touched
const FAKE_HOME = mkdtempSync(join(tmpdir(), "aura-test-home-"));
const PROJECT_DIR = mkdtempSync(join(tmpdir(), "aura-test-project-"));
const AURA_DIR = join(FAKE_HOME, ".aura");

let pass = 0;
let fail = 0;

function ok(desc) { pass++; console.log(`  \u2713 ${desc}`); }
function no(desc) { fail++; console.log(`  \u2717 ${desc}`); }

function runHook(eventType, stdinData = "{}") {
  return execSync(`node "${HOOK}" ${eventType}`, {
    input: stdinData,
    env: { ...process.env, HOME: FAKE_HOME, CLAUDE_PROJECT_DIR: PROJECT_DIR },
    encoding: "utf8",
    timeout: 10000,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function runView(args = "") {
  return execSync(`node "${VIEW}" ${args}`, {
    env: { ...process.env, HOME: FAKE_HOME, CLAUDE_PROJECT_DIR: PROJECT_DIR },
    encoding: "utf8",
    timeout: 10000,
  });
}

function loadJSON(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function checkFile(path, desc) {
  existsSync(path) ? ok(desc) : no(`${desc} (file not found: ${path})`);
}

function checkField(path, fieldPath, expected, desc) {
  try {
    let obj = loadJSON(path);
    for (const key of fieldPath.split(".")) obj = obj[key];
    // loose comparison to handle number/string differences
    String(obj) === String(expected) ? ok(desc) : no(`${desc} (expected '${expected}', got '${obj}')`);
  } catch (e) {
    no(`${desc} (error: ${e.message})`);
  }
}

// ── Setup mock OpenSpec structure ───────────────────────────────────────────

console.log("");
console.log("═══════════════════════════════════════════════════════════════");
console.log("  AURA Metrics Hook — Integration Tests (Node.js)");
console.log("═══════════════════════════════════════════════════════════════");
console.log("");
console.log(`  AURA dir:    ${AURA_DIR}`);
console.log(`  Project dir: ${PROJECT_DIR}`);
console.log("");

console.log("Setting up mock OpenSpec change...");
const CHANGE_DIR = join(PROJECT_DIR, "openspec", "changes", "test-feature");
mkdirSync(join(CHANGE_DIR, "specs"), { recursive: true });
writeFileSync(join(CHANGE_DIR, "proposal.md"), "# Test Feature Proposal\nAdd a test feature.\n");
writeFileSync(join(CHANGE_DIR, "specs", "delta-spec.md"), "# Delta Spec\n## Requirements\n- Req 1\n- Req 2\n- Req 3\n");
writeFileSync(join(CHANGE_DIR, "design.md"), "# Design\nSimple approach.\n");
writeFileSync(join(CHANGE_DIR, "tasks.md"), "# Tasks\n- [x] Task 1: Setup foundation\n- [x] Task 2: Implement core logic\n- [ ] Task 3: Add tests\n");
console.log("");

// ── Test 1: SessionStart (no active deliverables) ──────────────────────────

console.log("Test 1: SessionStart (no active deliverables)");
try { runHook("SessionStart"); ok("SessionStart runs without error"); }
catch { no("SessionStart crashed"); }

// ── Test 2: /opsx:propose ──────────────────────────────────────────────────

console.log("");
console.log("Test 2: /opsx:propose test-feature");
runHook("UserPromptSubmit", JSON.stringify({ prompt: "/opsx:propose test-feature" }));
const stateFile = join(AURA_DIR, "deliverables", "test-feature.json");
checkFile(stateFile, "State file created");
checkField(stateFile, "status", "propose", "Status is 'propose'");
checkField(stateFile, "change_id", "test-feature", "Change ID correct");

// ── Test 3: SessionStart (with active deliverable) ─────────────────────────

console.log("");
console.log("Test 3: SessionStart (with active deliverable)");
try {
  const result = execSync(`node "${HOOK}" SessionStart`, {
    input: "{}",
    env: { ...process.env, HOME: FAKE_HOME, CLAUDE_PROJECT_DIR: PROJECT_DIR },
    encoding: "utf8",
    timeout: 10000,
    stdio: ["pipe", "pipe", "pipe"],
  });
  // stderr goes to pipe, check via alternative approach
  const stderr = execSync(`node "${HOOK}" SessionStart 2>&1 1>/dev/null || true`, {
    input: "{}",
    env: { ...process.env, HOME: FAKE_HOME, CLAUDE_PROJECT_DIR: PROJECT_DIR },
    encoding: "utf8",
    timeout: 10000,
  });
  stderr.includes("test-feature") ? ok("SessionStart detects active deliverable") : no("SessionStart should report active deliverable on stderr");
} catch {
  no("SessionStart detection failed");
}

// ── Test 4: /opsx:ff ───────────────────────────────────────────────────────

console.log("");
console.log("Test 4: /opsx:ff test-feature");
runHook("UserPromptSubmit", JSON.stringify({ prompt: "/opsx:ff test-feature" }));
checkField(stateFile, "status", "tasks", "Status is 'tasks' after ff");

try {
  const d = loadJSON(stateFile);
  let allGood = true;
  for (const phase of ["specs", "design", "tasks"]) {
    if (!d.phases[phase] || !d.phases[phase].started_at || !d.phases[phase].completed_at) {
      allGood = false;
      break;
    }
  }
  allGood ? ok("All ff phases have timestamps") : no("FF phases missing timestamps");
} catch { no("FF phases check error"); }

// ── Test 5: /opsx:apply ────────────────────────────────────────────────────

console.log("");
console.log("Test 5: /opsx:apply test-feature");
runHook("UserPromptSubmit", JSON.stringify({ prompt: "/opsx:apply test-feature" }));
checkField(stateFile, "status", "apply", "Status is 'apply'");

// ── Test 6: PostToolUse ────────────────────────────────────────────────────

console.log("");
console.log("Test 6: PostToolUse (simulating tool calls)");
for (const tool of ["Write", "Write", "Edit", "Bash", "Read", "Grep", "Glob", "Write"]) {
  runHook("PostToolUse", JSON.stringify({ tool_name: tool }));
}
checkField(stateFile, "tool_calls.Write", "3", "Write count = 3");
checkField(stateFile, "tool_calls.Edit", "1", "Edit count = 1");
checkField(stateFile, "tool_calls.Bash", "1", "Bash count = 1");
checkField(stateFile, "tool_calls.total", "8", "Total count = 8");

// ── Test 7: Stop (during apply phase) ──────────────────────────────────────

console.log("");
console.log("Test 7: Stop (during apply phase)");
runHook("Stop");
checkField(stateFile, "apply_iterations", "1", "Apply iterations = 1");
runHook("Stop");
checkField(stateFile, "apply_iterations", "2", "Apply iterations = 2 after second stop");

// ── Test 8: /opsx:verify ───────────────────────────────────────────────────

console.log("");
console.log("Test 8: /opsx:verify test-feature");
runHook("UserPromptSubmit", JSON.stringify({ prompt: "/opsx:verify test-feature" }));
checkField(stateFile, "status", "verify", "Status is 'verify'");

runHook("Stop");
checkField(stateFile, "spec_data.tasks_count", "3", "Tasks count = 3");
checkField(stateFile, "spec_data.tasks_completed", "2", "Tasks completed = 2");

// ── Test 9: /opsx:archive ──────────────────────────────────────────────────

console.log("");
console.log("Test 9: /opsx:archive test-feature");
runHook("UserPromptSubmit", JSON.stringify({ prompt: "/opsx:archive test-feature" }));
checkField(stateFile, "status", "completed", "Status is 'completed'");

const metricsFile = join(AURA_DIR, "metrics", "test-feature.json");
checkFile(metricsFile, "Metrics file created");

console.log("");
console.log("Validating metrics output...");
checkField(metricsFile, "change_id", "test-feature", "Metrics change_id correct");
checkField(metricsFile, "metrics.deliverable_failed", "false", "Deliverable not failed");
checkField(metricsFile, "metrics.tasks_total", "3", "Metrics tasks_total = 3");
checkField(metricsFile, "metrics.tasks_completed", "2", "Metrics tasks_completed = 2");

try {
  const m = loadJSON(metricsFile);
  const c = m.metrics.conformance;
  let allOk = true;
  if (c.functional < 0 || c.functional > 1) allOk = false;
  if (c.correctness < 0 || c.correctness > 1) allOk = false;
  if (c.constraints < 0 || c.constraints > 1) allOk = false;
  if (c.overall < 0 || c.overall > 1) allOk = false;
  if (Math.abs(c.functional - 2 / 3) > 0.01) allOk = false;
  if (c.correctness !== 1.0) allOk = false;
  allOk ? ok("Conformance scores are valid") : no("Conformance scores invalid");
} catch { no("Conformance check error"); }

// ── Test 10: aura-view.mjs ─────────────────────────────────────────────────

console.log("");
console.log("Test 10: aura-view.mjs");
try { runView(); ok("aura-view.mjs runs without error"); }
catch { no("aura-view.mjs crashed"); }

try { runView("--json"); ok("aura-view.mjs --json runs without error"); }
catch { no("aura-view.mjs --json crashed"); }

try {
  const out = runView("--json");
  const data = JSON.parse(out);
  data.completed_metrics && data.completed_metrics.length === 1
    ? ok("aura-view.mjs --json output is valid")
    : no("aura-view.mjs --json output invalid");
} catch { no("aura-view.mjs --json parse error"); }

// ── Test 11: suppressOutput ────────────────────────────────────────────────

console.log("");
console.log("Test 11: Hook output");
try {
  const out = runHook("UserPromptSubmit", JSON.stringify({ prompt: "hello world" }));
  const d = JSON.parse(out.trim());
  d.suppressOutput === true
    ? ok("Non-opsx prompts output suppressOutput: true")
    : no("Expected suppressOutput JSON");
} catch { no("suppressOutput check failed"); }

// ── Test 12: PostToolUse outside apply ──────────────────────────────────────

console.log("");
console.log("Test 12: PostToolUse outside apply phase");
runHook("UserPromptSubmit", JSON.stringify({ prompt: "/opsx:propose test-feature-2" }));
runHook("PostToolUse", JSON.stringify({ tool_name: "Write" }));
const stateFile2 = join(AURA_DIR, "deliverables", "test-feature-2.json");
checkField(stateFile2, "tool_calls.total", "0", "Tool calls not incremented outside apply");

// ══════════════════════════════════════════════════════════════════════════════
// SpecKit Adapter Tests
// ══════════════════════════════════════════════════════════════════════════════

console.log("");
console.log("═══════════════════════════════════════════════════════════════");
console.log("  SpecKit Adapter Tests");
console.log("═══════════════════════════════════════════════════════════════");

// New isolated dirs for SpecKit tests
const SK_HOME = mkdtempSync(join(tmpdir(), "aura-test-sk-home-"));
const SK_PROJECT = mkdtempSync(join(tmpdir(), "aura-test-sk-project-"));
const SK_AURA = join(SK_HOME, ".aura");

function runSkHook(eventType, stdinData = "{}") {
  return execSync(`node "${HOOK}" ${eventType}`, {
    input: stdinData,
    env: { ...process.env, HOME: SK_HOME, CLAUDE_PROJECT_DIR: SK_PROJECT },
    encoding: "utf8",
    timeout: 10000,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// Write SpecKit adapter config
writeFileSync(join(SK_PROJECT, ".aura.json"), JSON.stringify({
  adapter: "speckit",
  commands: {
    "/speckit.specify": "propose",
    "/speckit.plan": "advance",
    "/speckit.tasks": "advance",
    "/speckit.implement": "apply",
    "/speckit.checklist": "verify",
    "/aura:archive": "archive",
  },
  changes_dir: "specs",
  tasks_patterns: ["tasks.md"],
}, null, 2));

// Create SpecKit-style spec structure
const SK_SPEC_DIR = join(SK_PROJECT, "specs", "add-auth");
mkdirSync(SK_SPEC_DIR, { recursive: true });
writeFileSync(join(SK_SPEC_DIR, "spec.md"), "# Auth Spec\n- Req A\n- Req B\n");
writeFileSync(join(SK_SPEC_DIR, "plan.md"), "# Plan\nUse JWT.\n");
writeFileSync(join(SK_SPEC_DIR, "tasks.md"), "# Tasks\n- [x] Task A\n- [x] Task B\n- [x] Task C\n- [ ] Task D\n");
console.log("");

// ── Test 13: SpecKit /speckit.specify ───────────────────────────────────────

console.log("Test 13: /speckit.specify add-auth");
runSkHook("UserPromptSubmit", JSON.stringify({ prompt: "/speckit.specify add-auth" }));
const skState = join(SK_AURA, "deliverables", "add-auth.json");
checkFile(skState, "SpecKit state file created");
checkField(skState, "status", "propose", "SpecKit status is 'propose'");
checkField(skState, "adapter", "speckit", "Adapter recorded as 'speckit'");

// ── Test 14: SpecKit /speckit.plan ─────────────────────────────────────────

console.log("");
console.log("Test 14: /speckit.plan (advance)");
runSkHook("UserPromptSubmit", JSON.stringify({ prompt: "/speckit.plan" }));
checkField(skState, "status", "specs", "Status advanced to 'specs'");

// ── Test 15: SpecKit /speckit.tasks ────────────────────────────────────────

console.log("");
console.log("Test 15: /speckit.tasks (advance again)");
runSkHook("UserPromptSubmit", JSON.stringify({ prompt: "/speckit.tasks" }));
checkField(skState, "status", "design", "Status advanced to 'design'");

// ── Test 16: SpecKit /speckit.implement ────────────────────────────────────

console.log("");
console.log("Test 16: /speckit.implement (apply)");
runSkHook("UserPromptSubmit", JSON.stringify({ prompt: "/speckit.implement" }));
checkField(skState, "status", "apply", "SpecKit status is 'apply'");

// Tool calls during apply
runSkHook("PostToolUse", JSON.stringify({ tool_name: "Write" }));
runSkHook("PostToolUse", JSON.stringify({ tool_name: "Edit" }));
checkField(skState, "tool_calls.Write", "1", "SpecKit Write count = 1");
checkField(skState, "tool_calls.total", "2", "SpecKit total count = 2");

// ── Test 17: SpecKit /speckit.checklist ────────────────────────────────────

console.log("");
console.log("Test 17: /speckit.checklist (verify)");
runSkHook("UserPromptSubmit", JSON.stringify({ prompt: "/speckit.checklist" }));
checkField(skState, "status", "verify", "SpecKit status is 'verify'");

// ── Test 18: SpecKit /aura:archive ─────────────────────────────────────────

console.log("");
console.log("Test 18: /aura:archive (complete)");
runSkHook("UserPromptSubmit", JSON.stringify({ prompt: "/aura:archive" }));
checkField(skState, "status", "completed", "SpecKit status is 'completed'");

const skMetrics = join(SK_AURA, "metrics", "add-auth.json");
checkFile(skMetrics, "SpecKit metrics file created");
checkField(skMetrics, "adapter", "speckit", "Metrics record adapter is 'speckit'");
checkField(skMetrics, "metrics.tasks_total", "4", "SpecKit tasks_total = 4");
checkField(skMetrics, "metrics.tasks_completed", "3", "SpecKit tasks_completed = 3");

// ── Test 19: Fallback to default adapter (no .aura.json) ──────────────────

console.log("");
console.log("Test 19: No .aura.json falls back to OpenSpec");
const NO_CFG_HOME = mkdtempSync(join(tmpdir(), "aura-test-nocfg-"));
const NO_CFG_PROJECT = mkdtempSync(join(tmpdir(), "aura-test-nocfg-proj-"));
// No .aura.json written — should use default OpenSpec adapter
try {
  const out = execSync(`node "${HOOK}" UserPromptSubmit`, {
    input: JSON.stringify({ prompt: "/opsx:propose fallback-test" }),
    env: { ...process.env, HOME: NO_CFG_HOME, CLAUDE_PROJECT_DIR: NO_CFG_PROJECT },
    encoding: "utf8",
    timeout: 10000,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const ncState = join(NO_CFG_HOME, ".aura", "deliverables", "fallback-test.json");
  checkFile(ncState, "Fallback: state created without .aura.json");
  checkField(ncState, "adapter", "openspec", "Fallback: adapter is 'openspec'");
  try { rmSync(NO_CFG_HOME, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(NO_CFG_PROJECT, { recursive: true, force: true }); } catch { /* ignore */ }
} catch (e) {
  no(`Fallback test failed: ${e.message}`);
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

try { rmSync(FAKE_HOME, { recursive: true, force: true }); } catch { /* ignore */ }
try { rmSync(PROJECT_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
try { rmSync(SK_HOME, { recursive: true, force: true }); } catch { /* ignore */ }
try { rmSync(SK_PROJECT, { recursive: true, force: true }); } catch { /* ignore */ }

// ── Summary ─────────────────────────────────────────────────────────────────

console.log("");
console.log("═══════════════════════════════════════════════════════════════");
const total = pass + fail;
if (fail === 0) {
  console.log(`  All ${total} tests passed \u2713`);
} else {
  console.log(`  ${pass}/${total} passed, ${fail} failed \u2717`);
}
console.log("═══════════════════════════════════════════════════════════════");
console.log("");

process.exit(fail);
