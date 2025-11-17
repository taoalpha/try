#!/usr/bin/env node

// Minimal Node-based test runner for try.js
// No external deps; uses built-in assert and child_process.

const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const TRY_JS = path.join(PROJECT_ROOT, "try.js");

function runCmd(args, opts = {}) {
  const res = spawnSync("node", [TRY_JS, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...(opts.env || {}) },
    cwd: opts.cwd || PROJECT_ROOT,
  });
  return res;
}

function stripAnsi(s) {
  return s.replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/g, "");
}

function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "try-test-"));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- Tests ---

function testHelpFlagPrintsUsage() {
  const { stdout, status } = runCmd(["--help"]);
  assert.strictEqual(status, 0, "--help should exit 0");
  assert(
    /Usage:/i.test(stdout),
    "help output should contain 'Usage:' in stdout"
  );
}

function testNoArgsPrintsUsage() {
  const { stdout, status } = runCmd([]);
  assert.strictEqual(status, 2, "no-arg invocation should exit 2");
  assert(/Usage:/i.test(stdout), "no-arg invocation should print Usage text");
}

function testInitEmitsBashFunctionWithPath() {
  withTmpDir((dir) => {
    const { stdout, status } = runCmd(["init", dir], {
      env: { SHELL: "/bin/bash" },
    });
    assert.strictEqual(status, 0, "init bash wrapper should exit 0");
    assert(/try\(\) \{/.test(stdout), "bash wrapper should define try()");
    const escaped = dir.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    assert(
      new RegExp(`cd --path "${escaped}"`).test(stdout),
      "wrapper should pass --path with expanded dir"
    );
    assert(/rc=\$\?/.test(stdout), "wrapper should capture rc=$?");
    assert(
      /if\s*\[\s*\$rc\s*-eq\s*10\s*\]; then/.test(stdout),
      "wrapper should branch on rc==10"
    );
    assert(/eval "\$cmd"/.test(stdout), "wrapper should eval $cmd for rc==10");
  });
}

function testCdAndExitRendersTuiSnapshot() {
  withTmpDir((dir) => {
    // Seed a couple of directories
    fs.mkdirSync(path.join(dir, "2025-08-14-redis-connection-pool"));
    fs.mkdirSync(path.join(dir, "thread-pool"));

    const { stdout, stderr, status } = runCmd([
      "cd",
      "--and-type",
      "pool",
      "--and-exit",
      "--path",
      dir,
    ]);
    assert.strictEqual(status, 0, "--and-exit should exit 0");
    const combined = stripAnsi(stdout + stderr);

    assert(
      /Try Directory Selection/.test(combined),
      "TUI header should be present"
    );
    assert(/Search: pool/.test(combined), "Search line should include query");
    assert(
      /redis-connection-pool/.test(combined),
      "should list seeded directory"
    );
    assert(/thread-pool/.test(combined), "should list second directory");
    assert(/Create new: pool/.test(combined), "should show create-new line");
  });
}

function testCloneEmitsScriptWithCorrectUrlAndName() {
  withTmpDir((dir) => {
    const { stdout, status } = runCmd([
      "clone",
      "https://github.com/taoalpha/try.git",
      "my-fork",
      "--path",
      dir,
    ]);
    assert.strictEqual(status, EXIT_EVAL, "clone should exit with EXIT_EVAL");
    assert(/mkdir -p '\S+my-fork'/.test(stdout), "should mkdir my-fork");
    assert(
      /git clone 'https:\/\/github\.com\/taoalpha\/try\.git' '\S+my-fork'/.test(
        stdout
      ),
      "should clone from taoalpha/try.git"
    );
    assert(/cd '\S+my-fork'/.test(stdout), "should cd into my-fork");
  });
}

function testCreateNewGeneratesMkdirAndCd() {
  withTmpDir((dir) => {
    const { stdout } = runCmd([
      "cd",
      "new-thing",
      "--and-keys",
      "ENTER",
      "--path",
      dir,
    ]);
    // EXIT_EVAL status is asserted in other tests; here we just check script shape.
    assert(
      /mkdir -p '\S+new-thing'/.test(stdout),
      "should mkdir date-prefixed new-thing dir"
    );
    assert(
      /cd '\S+new-thing'/.test(stdout),
      "should cd into created directory"
    );
    assert(
      /\d{4}-\d{2}-\d{2}-new-thing/.test(stdout),
      "path should include date-prefixed name"
    );
  });
}

// --- Run tests ---

function main() {
  const tests = [
    testHelpFlagPrintsUsage,
    testNoArgsPrintsUsage,
    testInitEmitsBashFunctionWithPath,
    testCdAndExitRendersTuiSnapshot,
    testCreateNewGeneratesMkdirAndCd,
  ];

  let failed = 0;
  tests.forEach((fn) => {
    try {
      fn();
      process.stderr.write(`✓ ${fn.name}\n`);
    } catch (err) {
      failed += 1;
      process.stderr.write(`✗ ${fn.name}: ${err && err.message}\n`);
    }
  });

  process.exitCode = failed === 0 ? 0 : 1;
}

// EXIT_EVAL constant must be kept in sync with try.js
const EXIT_EVAL = 10;

if (require.main === module) {
  main();
}
