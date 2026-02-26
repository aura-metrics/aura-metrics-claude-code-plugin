#!/usr/bin/env node
/**
 * AURA Metrics Viewer — display active deliverables, completed metrics, and aggregated stats.
 *
 * Usage: node aura-view.mjs [--json]
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const AURA_DIR = join(homedir(), ".aura");
const DELIVERABLES_DIR = join(AURA_DIR, "deliverables");
const METRICS_DIR = join(AURA_DIR, "metrics");

const PHASES = ["propose", "specs", "design", "tasks", "apply", "verify", "archive"];

// ── Performance tiers ───────────────────────────────────────────────────────

const TIERS = {
  throughput: [
    ["Elite", v => v >= 3.0],
    ["High", v => v >= 1.0],
    ["Medium", v => v >= 1.0 / 7],
    ["Low", () => true],
  ],
  latency: [
    ["Elite", v => v < 3600],
    ["High", v => v < 14400],
    ["Medium", v => v < 86400],
    ["Low", () => true],
  ],
  failure_rate: [
    ["Elite", v => v < 0.05],
    ["High", v => v < 0.10],
    ["Medium", v => v < 0.15],
    ["Low", () => true],
  ],
  recovery: [
    ["Elite", v => v < 0.05],
    ["High", v => v < 0.10],
    ["Medium", v => v < 0.20],
    ["Low", () => true],
  ],
  conformance: [
    ["Elite", v => v >= 0.95],
    ["High", v => v >= 0.85],
    ["Medium", v => v >= 0.70],
    ["Low", () => true],
  ],
};

function classify(metricName, value) {
  for (const [tier, test] of (TIERS[metricName] || [])) {
    if (test(value)) return tier;
  }
  return "Unknown";
}

function tierColor(tier) {
  const colors = { Elite: "\x1b[92m", High: "\x1b[94m", Medium: "\x1b[93m", Low: "\x1b[91m" };
  return colors[tier] || "";
}

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function formatDuration(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return `${d}d ${h}h`;
}

function loadJSONFiles(dir) {
  if (!existsSync(dir)) return [];
  const results = [];
  for (const f of readdirSync(dir).filter(x => x.endsWith(".json")).sort()) {
    try {
      results.push(JSON.parse(readFileSync(join(dir, f), "utf8")));
    } catch { continue; }
  }
  return results;
}

function loadActiveDeliverables() {
  return loadJSONFiles(DELIVERABLES_DIR).filter(s => s.status !== "completed");
}

function loadCompletedMetrics() {
  return loadJSONFiles(METRICS_DIR);
}

function separator(ch = "\u2500", width = 72) {
  console.log(DIM + ch.repeat(width) + RESET);
}

function displayActive(deliverables) {
  console.log(`\n${BOLD}Active Deliverables${RESET}`);
  separator();

  if (!deliverables.length) {
    console.log(`  ${DIM}No active deliverables${RESET}`);
    return;
  }

  for (const d of deliverables) {
    const phase = d.status || "unknown";
    const changeId = d.change_id || "unknown";
    let elapsed = "";
    if (d.started_at) {
      try {
        const delta = (Date.now() - new Date(d.started_at).getTime()) / 1000;
        elapsed = ` (${formatDuration(delta)} elapsed)`;
      } catch { /* ignore */ }
    }

    const phaseIdx = PHASES.indexOf(phase);
    const bar = PHASES.map((_, i) => {
      if (i < phaseIdx) return `\x1b[92m\u25a0${RESET} `;
      if (i === phaseIdx) return `\x1b[93m\u25b6${RESET} `;
      return `${DIM}\u25cb${RESET} `;
    }).join("");

    console.log(`  ${BOLD}${changeId}${RESET}${elapsed}`);
    console.log(`    Phase: ${bar}`);
    console.log(`    Tool calls: ${(d.tool_calls || {}).total || 0}  |  ` +
      `Apply iterations: ${d.apply_iterations || 0}  |  ` +
      `Recovery attempts: ${d.recovery_attempts || 0}`);
    console.log();
  }
}

function displayCompleted(metrics, limit = 10) {
  console.log(`\n${BOLD}Completed Deliverables${RESET}`);
  separator();

  if (!metrics.length) {
    console.log(`  ${DIM}No completed deliverables${RESET}`);
    return;
  }

  const recent = [...metrics]
    .sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || ""))
    .slice(0, limit);

  for (const m of recent) {
    const cid = m.change_id || "unknown";
    const completed = (m.completed_at || "").slice(0, 19).replace("T", " ");
    const met = m.metrics || {};

    const latency = met.resolution_latency_seconds || 0;
    const latencyTier = classify("latency", latency);

    const conf = met.conformance || {};
    const overall = conf.overall || 0;
    const confTier = classify("conformance", overall);

    const failed = met.deliverable_failed;
    const status = failed ? `\x1b[91mFAILED${RESET}` : `\x1b[92mPASSED${RESET}`;

    const toolsTotal = (met.tool_calls || {}).total || 0;

    console.log(`  ${BOLD}${cid}${RESET}  [${status}]  ${DIM}${completed}${RESET}`);
    let tc = tierColor(latencyTier);
    console.log(`    Latency: ${formatDuration(latency)} [${tc}${latencyTier}${RESET}]  |  ` +
      `Tools: ${toolsTotal}  |  Iterations: ${met.apply_iterations || 0}`);
    tc = tierColor(confTier);
    console.log(`    Conformance: ${overall.toFixed(2)} [${tc}${confTier}${RESET}]  ` +
      `(fn=${(conf.functional || 0).toFixed(2)} cr=${(conf.correctness || 0).toFixed(2)} ` +
      `cn=${(conf.constraints || 0).toFixed(2)})`);
    console.log();
  }
}

function displayAggregated(metrics) {
  console.log(`\n${BOLD}Aggregated AURA Metrics${RESET}`);
  separator();

  if (!metrics.length) {
    console.log(`  ${DIM}No data to aggregate${RESET}`);
    return;
  }

  const now = Date.now();
  const inWindow = (m, days) => {
    try { return (now - new Date(m.completed_at).getTime()) / 86400000 < days; }
    catch { return false; }
  };

  const last7 = metrics.filter(m => inWindow(m, 7));
  const last30 = metrics.filter(m => inWindow(m, 30));
  const totalCount = metrics.length;

  const throughput7 = last7.length / 7;
  const throughputTier = classify("throughput", throughput7);

  const latencies = metrics.map(m => (m.metrics || {}).resolution_latency_seconds || 0);
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const latencyTier = classify("latency", avgLatency);

  const failedCount = metrics.filter(m => (m.metrics || {}).deliverable_failed).length;
  const failureRate = totalCount > 0 ? failedCount / totalCount : 0;
  const failureTier = classify("failure_rate", failureRate);

  const totalIterations = metrics.reduce((s, m) => s + ((m.metrics || {}).apply_iterations || 0), 0);
  const totalRecovery = metrics.reduce((s, m) => s + ((m.metrics || {}).recovery_attempts || 0), 0);
  const recoveryOverhead = totalIterations > 0 ? totalRecovery / totalIterations : 0;
  const recoveryTier = classify("recovery", recoveryOverhead);

  const conformances = metrics.map(m => ((m.metrics || {}).conformance || {}).overall || 0);
  const meanConformance = conformances.reduce((a, b) => a + b, 0) / conformances.length;
  const conformanceTier = classify("conformance", meanConformance);

  console.log(`  Total deliverables: ${totalCount}  |  Last 7d: ${last7.length}  |  Last 30d: ${last30.length}`);
  console.log();

  const pad = (s, n) => s + " ".repeat(Math.max(0, n - s.length));
  console.log(`  ${pad("Metric", 25)} ${pad("Value", 20)} Tier`);
  console.log(`  ${"─".repeat(55)}`);

  let tc = tierColor(throughputTier);
  console.log(`  ${pad("Feature Throughput", 25)} ${pad(`${throughput7.toFixed(2)}/day (7d)`, 20)} ${tc}${throughputTier}${RESET}`);

  tc = tierColor(latencyTier);
  console.log(`  ${pad("Resolution Latency", 25)} ${pad(formatDuration(avgLatency), 20)} ${tc}${latencyTier}${RESET}`);

  tc = tierColor(failureTier);
  console.log(`  ${pad("Failure Rate", 25)} ${pad(`${(failureRate * 100).toFixed(1)}%`, 20)} ${tc}${failureTier}${RESET}`);

  tc = tierColor(recoveryTier);
  console.log(`  ${pad("Recovery Efficiency", 25)} ${pad(`${(recoveryOverhead * 100).toFixed(1)}% overhead`, 20)} ${tc}${recoveryTier}${RESET}`);

  tc = tierColor(conformanceTier);
  console.log(`  ${pad("Spec Conformance", 25)} ${pad(meanConformance.toFixed(3), 20)} ${tc}${conformanceTier}${RESET}`);

  console.log();
}

function displayJSON(active, metrics) {
  console.log(JSON.stringify({ active_deliverables: active, completed_metrics: metrics }, null, 2));
}

// ── Main ────────────────────────────────────────────────────────────────────

const jsonMode = process.argv.includes("--json");

const active = loadActiveDeliverables();
const completed = loadCompletedMetrics();

if (jsonMode) {
  displayJSON(active, completed);
} else {
  console.log(`\n${BOLD}${"═".repeat(72)}${RESET}`);
  console.log(`${BOLD}  AURA Metrics Dashboard${RESET}`);
  console.log(`${BOLD}${"═".repeat(72)}${RESET}`);
  displayActive(active);
  displayCompleted(completed);
  displayAggregated(completed);
  separator("═");
  console.log();
}
