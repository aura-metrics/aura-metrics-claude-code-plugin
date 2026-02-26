#!/usr/bin/env node
/**
 * AURA Setup — configure which spec framework to use for metrics collection.
 *
 * Usage:
 *   node aura-setup.mjs                  # interactive
 *   node aura-setup.mjs openspec         # direct
 *   node aura-setup.mjs speckit          # direct
 *   node aura-setup.mjs custom           # prompts for custom config
 */

import { writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { createInterface } from "readline";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const CONFIG_PATH = join(PROJECT_DIR, ".aura.json");

// ── Built-in adapters ───────────────────────────────────────────────────────

const ADAPTERS = {
  openspec: {
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
  },
  speckit: {
    adapter: "speckit",
    commands: {
      "/speckit.specify": "propose",
      "/speckit.plan": "advance",
      "/speckit.tasks": "advance",
      "/speckit.implement": "apply",
      "/speckit.checklist": "verify",
      "/speckit.analyze": "verify",
      "/aura:archive": "archive",
    },
    changes_dir: "specs",
    tasks_patterns: ["tasks.md"],
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[92m";
const YELLOW = "\x1b[93m";
const RESET = "\x1b[0m";

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function writeConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2];

  console.log("");
  console.log(`${BOLD}AURA Setup${RESET}`);
  console.log(`${"─".repeat(50)}`);
  console.log("");

  // Check for existing config
  if (existsSync(CONFIG_PATH)) {
    try {
      const existing = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
      console.log(`${YELLOW}Existing config found:${RESET} ${CONFIG_PATH}`);
      console.log(`  Adapter: ${existing.adapter}`);
      console.log("");
    } catch { /* ignore */ }
  }

  // Direct mode: adapter name passed as argument
  if (arg && arg !== "custom") {
    const adapter = ADAPTERS[arg.toLowerCase()];
    if (!adapter) {
      console.log(`Unknown adapter: ${arg}`);
      console.log(`Available: ${Object.keys(ADAPTERS).join(", ")}, custom`);
      process.exit(1);
    }
    writeConfig(adapter);
    console.log(`${GREEN}Wrote${RESET} ${CONFIG_PATH}`);
    console.log(`  Adapter: ${adapter.adapter}`);
    console.log(`  Commands: ${Object.keys(adapter.commands).join(", ")}`);
    console.log(`  Changes dir: ${adapter.changes_dir}`);
    console.log("");
    process.exit(0);
  }

  // Interactive mode
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("Which spec framework are you using?");
  console.log("");
  console.log(`  ${BOLD}1${RESET}) OpenSpec  ${DIM}(/opsx:propose, /opsx:apply, ...)${RESET}`);
  console.log(`  ${BOLD}2${RESET}) SpecKit   ${DIM}(/speckit.specify, /speckit.implement, ...)${RESET}`);
  console.log(`  ${BOLD}3${RESET}) Custom    ${DIM}(define your own commands and paths)${RESET}`);
  console.log("");

  const choice = (await ask(rl, "Choice [1/2/3]: ")).trim();

  if (choice === "1" || choice.toLowerCase() === "openspec") {
    writeConfig(ADAPTERS.openspec);
    console.log("");
    console.log(`${GREEN}Wrote${RESET} ${CONFIG_PATH} (OpenSpec)`);

  } else if (choice === "2" || choice.toLowerCase() === "speckit") {
    writeConfig(ADAPTERS.speckit);
    console.log("");
    console.log(`${GREEN}Wrote${RESET} ${CONFIG_PATH} (SpecKit)`);

  } else if (choice === "3" || choice.toLowerCase() === "custom") {
    console.log("");
    console.log("Enter custom configuration:");
    console.log(`${DIM}(press Enter to accept defaults shown in brackets)${RESET}`);
    console.log("");

    const name = (await ask(rl, `  Adapter name [custom]: `)).trim() || "custom";
    const changesDir = (await ask(rl, `  Changes directory [specs]: `)).trim() || "specs";
    const tasksFile = (await ask(rl, `  Tasks filename [tasks.md]: `)).trim() || "tasks.md";

    console.log("");
    console.log("Define command → action mappings.");
    console.log(`${DIM}Actions: propose, advance, fast_forward, apply, verify, archive${RESET}`);
    console.log(`${DIM}Enter blank line when done.${RESET}`);
    console.log("");

    const commands = {};
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const cmd = (await ask(rl, `  Command (e.g. /myspec:build): `)).trim();
      if (!cmd) break;
      const action = (await ask(rl, `  Action for '${cmd}': `)).trim();
      if (action) commands[cmd] = action;
    }

    // Always include a fallback archive command
    if (!Object.values(commands).includes("archive")) {
      commands["/aura:archive"] = "archive";
    }

    const config = {
      adapter: name,
      commands,
      changes_dir: changesDir,
      tasks_patterns: [tasksFile],
    };

    writeConfig(config);
    console.log("");
    console.log(`${GREEN}Wrote${RESET} ${CONFIG_PATH} (${name})`);

  } else {
    console.log("Invalid choice.");
    rl.close();
    process.exit(1);
  }

  rl.close();

  console.log("");
  console.log("Next steps:");
  console.log(`  1. Use your spec commands normally — AURA tracks metrics automatically`);
  console.log(`  2. View metrics: ${DIM}node .claude/hooks/aura-view.mjs${RESET}`);
  console.log("");
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
