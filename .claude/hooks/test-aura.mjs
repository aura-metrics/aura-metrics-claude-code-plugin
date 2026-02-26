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

// ── Cleanup ─────────────────────────────────────────────────────────────────

try { rmSync(FAKE_HOME, { recursive: true, force: true }); } catch { /* ignore */ }
try { rmSync(PROJECT_DIR, { recursive: true, force: true }); } catch { /* ignore */ }

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
