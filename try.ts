#!/usr/bin/env node

/**
 * Node.js equivalent of try.rb
 * - Single-file CLI/TUI
 * - No external dependencies
 * - Mirrors commands and UI behavior: init, cd, clone, worktree
 * - Emits shell-neutral command scripts for the wrapper function
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as cp from "child_process";
import * as readline from "readline";
import { fileURLToPath } from "url";

// Special exit code used to signal that the printed command should be eval'd by the shell wrapper.
// Non-zero so it doesn't collide with "plain print" success (0), but reserved for "eval this".
const EXIT_EVAL = 10;

function safeStderrWrite(data: string) {
  if (!process.stderr.isTTY) return;
  try {
    process.stderr.write(data);
  } catch {}
}

async function exit(code: number) {
  safeStderrWrite('\x1b[?1049l');
  process.exit(code);
}

class Debug {
  static enabled = false;

  static init(enabled: boolean) {
    Debug.enabled = !!enabled;
    if (!Debug.enabled) return;
    if (!fs.existsSync(Debug.filePath)) fs.writeFileSync(Debug.filePath, "");
    try {
      fs.appendFileSync(
        Debug.filePath,
        `\n=== try debug ${new Date().toISOString()} ===\n`
      );
    } catch {}
  }

  static get filePath() {
    return os.tmpdir() + "/try-debug.log";
  }

  static log(source: any, ...args: any[]) {
    if (!Debug.enabled) return;
    let ns = "Global";
    if (typeof source === "string" && source.length > 0) {
      ns = source;
    } else if (
      source &&
      source.constructor &&
      typeof source.constructor.name === "string" &&
      source.constructor.name.length > 0
    ) {
      ns = source.constructor.name;
    }
    const line = `[debug][${ns}] ${args.join(" ")}\n`;
    try {
      fs.appendFileSync(Debug.filePath, line);
    } catch {}
  }

  static callout() {
    process.stdout.write(`[debug] end of debug log file: ${Debug.filePath}\n`);
  }

  constructor() {
    throw new Error("Debug is a static class and cannot be instantiated");
  }
}

// Random name generator for non-interactive mode
class RandomName {
  static ADJECTIVES = [
    "swift", "bold", "calm", "dark", "eager", "fair", "glad", "happy",
    "keen", "lazy", "merry", "neat", "odd", "proud", "quick", "rare",
    "sage", "tall", "vast", "warm", "zesty", "bright", "clean", "deep",
    "fresh", "grand", "light", "noble", "pure", "rich", "sharp", "smart",
    "cool", "crisp", "dense", "dry", "dull", "epic", "fine", "flat",
    "fuzzy", "giant", "grim", "hazy", "icy", "lean", "loud", "mild",
  ];

  static NOUNS = [
    "fox", "owl", "bear", "wolf", "hawk", "lynx", "deer", "crow",
    "toad", "moth", "wasp", "crab", "fish", "wren", "duck", "mole",
    "hare", "newt", "pike", "slug", "vole", "orca", "seal", "yak",
    "tree", "leaf", "rock", "wave", "wind", "rain", "snow", "star",
    "moon", "sun", "lake", "cave", "hill", "peak", "vale", "reef",
    "seed", "vine", "fern", "moss", "root", "bark", "twig", "bud",
  ];

  static generate(): string {
    const adj = RandomName.ADJECTIVES[Math.floor(Math.random() * RandomName.ADJECTIVES.length)];
    const noun = RandomName.NOUNS[Math.floor(Math.random() * RandomName.NOUNS.length)];
    return `${adj}-${noun}`;
  }
}

// Lightweight token-based printer for all UI output with double buffering
class UI {
  static TOKEN_MAP: { [key: string]: string } = Object.freeze({
    "{text}": "\x1b[39m",
    "{dim_text}": "\x1b[90m",
    "{h1}": "\x1b[1;33m",
    "{h2}": "\x1b[1;36m",
    "{highlight}": "\x1b[1;33m",
    "{reset}": "\x1b[0m\x1b[39m\x1b[49m",
    "{reset_bg}": "\x1b[49m",
    "{reset_fg}": "\x1b[39m",
    "{clear_screen}": "\x1b[2J",
    "{clear_line}": "\x1b[2K",
    "{home}": "\x1b[H",
    "{clear_below}": "\x1b[0J",
    "{hide_cursor}": "\x1b[?25l",
    "{show_cursor}": "\x1b[?25h",
    "{start_selected}": "\x1b[1m",
    "{end_selected}": "\x1b[0m",
    "{bold}": "\x1b[1m",
  });

  static _instance: UI | null = null;
  buffer: string[];
  lastBuffer: string[];
  currentLine: string;

  constructor() {
    this.buffer = [];
    this.lastBuffer = [];
    this.currentLine = "";
  }
  static getInstance(): UI {
    if (!UI._instance) UI._instance = new UI();
    return UI._instance;
  }

  static expandTokens(str: string): string {
    return str.replace(/\{.*?\}/g, (m) => {
      if (UI.TOKEN_MAP[m] === undefined) throw new Error(`Unknown token: ${m}`);
      return UI.TOKEN_MAP[m];
    });
  }

  print(text: string | null, io: NodeJS.WritableStream = process.stderr): void {
    if (text == null) return;
    this.currentLine += text;
  }

  puts(text: string = "", io: NodeJS.WritableStream = process.stderr): void {
    this.currentLine += text;
    this.buffer.push(this.currentLine);
    this.currentLine = "";
  }

  cls(io: NodeJS.WritableStream = process.stderr): void {
    this.currentLine = "";
    this.buffer = [];
    this.lastBuffer = [];
    io.write("\x1b[2J\x1b[H");
  }

  flush(io: NodeJS.WriteStream = process.stderr): void {
    if (this.currentLine.length > 0) {
      this.buffer.push(this.currentLine);
      this.currentLine = "";
    }

    if (!io.isTTY) {
      const plain = this.buffer.join("\n").replace(/\{.*?\}/g, "");
      io.write(plain);
      if (!plain.endsWith("\n")) io.write("\n");
      this.lastBuffer = [];
      this.buffer = [];
      this.currentLine = "";
      io.write("");
      return;
    }

    io.write(UI.TOKEN_MAP["{home}"]);
    const maxLines = Math.max(this.buffer.length, this.lastBuffer.length);
    const reset = UI.TOKEN_MAP["{reset}"];
    for (let i = 0; i < maxLines; i++) {
      const current = this.buffer[i] || "";
      const last = this.lastBuffer[i] || "";
      if (current !== last) {
        // move cursor to line i and clear the content for rewrite
        io.write(`\x1b[${i + 1};1H\x1b[2K`);
        if (current.length > 0) {
          io.write(UI.expandTokens(current));
          io.write(reset);
        }
      }
    }
    // cache current content for next paint
    this.lastBuffer = this.buffer.slice();
    this.buffer = [];
    this.currentLine = "";
  }

  readKey(): Promise<string> {
    return new Promise((resolve) => {
      const onData = (data: Buffer) => {
        Debug.log(this, "readKey", "data=" + JSON.stringify(data));
        process.stdin.off("data", onData);
        resolve(data.toString("utf8"));
      };
      process.stdin.once("data", onData);
    });
  }

  height(): number {
    const h = process.stdout && process.stdout.rows ? process.stdout.rows : 0;
    if (h > 0) return h;
    try {
      const out = cp.execSync("tput lines 2>/dev/null").toString().trim();
      const n = parseInt(out, 10);
      if (!Number.isNaN(n) && n > 0) return n;
    } catch {}
    return 24;
  }

  width(): number {
    const w =
      process.stdout && process.stdout.columns ? process.stdout.columns : 0;
    if (w > 0) return w;
    try {
      const out = cp.execSync("tput cols 2>/dev/null").toString().trim();
      const n = parseInt(out, 10);
      if (!Number.isNaN(n) && n > 0) return n;
    } catch {}
    return 80;
  }
}

interface TryEntry {
  name: string;
  basename: string;
  path: string;
  is_new: boolean;
  ctime: Date;
  mtime: Date;
  score: number;
}

interface TrySelectorOptions {
  initialInput?: string | null;
  basePath?: string;
  testRenderOnce?: boolean;
  testNoCls?: boolean;
  testKeys?: string[] | null;
  testConfirm?: string | null;
}

interface SelectionResult {
    type: string;
    path: string | null;
    repo?: string;
}

class TrySelector {
  static TRY_PATH =
    process.env.TRY_PATH || path.resolve(os.homedir(), "workspaces/tries");

  searchTerm: string;
  cursorPos: number;
  scrollOffset: number;
  inputBuffer: string;
  selected: SelectionResult | null;
  allTries: TryEntry[] | null;
  basePath: string;
  deleteStatus: string | null;
  testRenderOnce: boolean;
  testNoCls: boolean;
  testKeys: string[] | null;
  testConfirm: string | null;
  keyQueue: string[];
  ui: UI;

  constructor(searchTerm: string = "", options: TrySelectorOptions = {}) {
    this.searchTerm = searchTerm.replace(/\s+/g, "-");
    this.cursorPos = 0;
    this.scrollOffset = 0;
    this.inputBuffer = options.initialInput
      ? options.initialInput.replace(/\s+/g, "-")
      : this.searchTerm;
    this.selected = null;
    this.allTries = null;
    this.basePath = options.basePath || TrySelector.TRY_PATH;
    this.deleteStatus = null;
    this.testRenderOnce = !!options.testRenderOnce;
    this.testNoCls = !!options.testNoCls;
    this.testKeys = Array.isArray(options.testKeys)
      ? options.testKeys.slice()
      : null;
    this.testConfirm = options.testConfirm || null;
    this.keyQueue = [];
    this.ui = UI.getInstance();
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  async run(): Promise<SelectionResult | null> {
    try {
      this.setupTerminal();
      if (this.testRenderOnce) {
        const tries = this.getTries();
        this.render(tries);
        return null;
      }
      const hasTTY = process.stdin.isTTY && process.stderr.isTTY;
      if (!hasTTY) {
        if (!this.testKeys || this.testKeys.length === 0) {
          this.ui.puts("Error: try requires an interactive terminal");
          return null;
        }
      } else {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        safeStderrWrite("\x1b[?25l");
      }
      return await this.mainLoop();
    } finally {
      this.restoreTerminal();
    }
  }

  setupTerminal() {
    if (!this.testNoCls) {
      this.ui.cls();
      safeStderrWrite("\x1b[2J\x1b[H\x1b[?25l");
    }
  }

  restoreTerminal() {
    try {
      if (!this.testNoCls) {
        safeStderrWrite("\x1b[2J\x1b[H\x1b[?25h");
      }
    } finally {
      try {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
      } catch {}
      try {
        process.stdin.pause();
      } catch {}
    }
  }

  loadAllTries(): TryEntry[] {
    if (this.allTries) return this.allTries;
    const entries: TryEntry[] = [];
    const dirents = fs.readdirSync(this.basePath, { withFileTypes: true });
    for (const d of dirents) {
      if (d.name === "." || d.name === "..") continue;
      if (!d.isDirectory()) continue;
      const p = path.join(this.basePath, d.name);
      let stat;
      try {
        stat = fs.statSync(p);
      } catch {
        continue;
      }
      entries.push({
        name: `📁 ${d.name}`,
        basename: d.name,
        path: p,
        is_new: false,
        ctime: stat.ctime,
        mtime: stat.mtime,
        score: 0,
      });
    }
    this.allTries = entries;
    return this.allTries;
  }

  getTries(): TryEntry[] {
    this.loadAllTries();
    if (!this.allTries) return [];
    const scored = this.allTries.map((t) => {
      const score = this.calculateScore(
        t.basename,
        this.inputBuffer,
        t.ctime,
        t.mtime
      );
      return { ...t, score };
    });
    if (!this.inputBuffer || this.inputBuffer.length === 0) {
      return scored.sort((a, b) => b.score - a.score);
    } else {
      const filtered = scored.filter((t) => t.score > 0);
      return filtered.sort((a, b) => b.score - a.score);
    }
  }

  calculateScore(text: string, query: string, ctime: Date, mtime: Date): number {
    let score = 0.0;
    if (/^\d{4}-\d{2}-\d{2}-/.test(text)) {
      score += 2.0;
    }
    if (query && query.length > 0) {
      const textLower = text.toLowerCase();
      const queryLower = query.toLowerCase();
      const qchars = Array.from(queryLower);
      let lastPos = -1;
      let qidx = 0;
      const tchars = Array.from(textLower);
      for (let pos = 0; pos < tchars.length; pos++) {
        if (qidx >= qchars.length) break;
        if (tchars[pos] !== qchars[qidx]) continue;
        score += 1.0;
        if (pos === 0 || /\W/.test(textLower[pos - 1])) score += 1.0;
        if (lastPos >= 0) {
          const gap = pos - lastPos - 1;
          score += 1.0 / Math.sqrt(gap + 1);
        }
        lastPos = pos;
        qidx += 1;
      }
      if (qidx < qchars.length) return 0.0;
      if (lastPos >= 0) {
        score *= qchars.length / (lastPos + 1);
      }
      score *= 10.0 / (text.length + 10.0);
    }
    const now = Date.now() / 1000;
    if (ctime) {
      const daysOld = (now - ctime.getTime() / 1000) / 86400.0;
      score += 2.0 / Math.sqrt(daysOld + 1);
    }
    if (mtime) {
      const hoursSince = (now - mtime.getTime() / 1000) / 3600.0;
      score += 3.0 / Math.sqrt(hoursSince + 1);
    }
    return score;
  }

  async mainLoop(): Promise<SelectionResult | null> {
    const nextKey = async () => {
      if (this.testKeys && this.testKeys.length > 0) {
        return this.testKeys.shift()!;
      }
      return await this.ui.readKey();
    };
    for (;;) {
      const tries = this.getTries();
      const totalItems = tries.length + 1;
      this.cursorPos = Math.max(0, Math.min(this.cursorPos, totalItems - 1));
      this.render(tries);
      const key = await nextKey();
      Debug.log(
        this,
        "key_read",
        `key=${JSON.stringify(key)}`,
        `cursor=${this.cursorPos}`,
        `selected=${JSON.stringify(this.selected)}`
      );
      switch (key) {
        // Enter key
        case "\r": {
          if (this.cursorPos < tries.length) {
            this.handleSelection(tries[this.cursorPos]);
          } else {
            await this.handleCreateNew();
          }
          Debug.log(
            this,
            "enter_pressed",
            `selected=${JSON.stringify(this.selected)}`
          );
          if (this.selected) return this.selected;
          break;
        }
        // Up arrow key
        case "\x1b[A":
        case "\x10":
        case "\x0B": {
          this.cursorPos = Math.max(0, this.cursorPos - 1);
          break;
        }
        // Down arrow key
        case "\x1b[B":
        case "\x0E":
        case "\n": {
          this.cursorPos = Math.min(totalItems - 1, this.cursorPos + 1);
          break;
        }
        // Backspace key
        case "\x7F":
        case "\b": {
          if (this.inputBuffer.length > 0) {
            this.inputBuffer = this.inputBuffer.slice(0, -1);
          }
          this.cursorPos = 0;
          break;
        }
        // Delete key
        case "\x04": {
          if (this.cursorPos < tries.length) {
            await this.handleDelete(tries[this.cursorPos]);
          }
          if (this.selected) return this.selected;
          break;
        }
        // Escape key
        case "\x03":
        case "\x1b": {
          this.selected = null;
          Debug.log(this, "cancel", "ESC/Ctrl-C -> exit");
          return this.selected;
        }
        // Other keys
        default: {
          if (typeof key === "string") {
            if (key.length === 1 && /[a-zA-Z0-9\-_\. ]/.test(key)) {
              this.inputBuffer += key;
              this.cursorPos = 0;
            } else if (key.startsWith("\x1b")) {
              // ignore unrecognized escape sequences
            }
          }
        }
      }
    }
  }

  render(tries: TryEntry[]) {
    Debug.log(this, "render", "tries=" + JSON.stringify(tries));
    const termWidth = this.ui.width();
    const termHeight = this.ui.height();
    const separator = "─".repeat(Math.max(0, termWidth - 1));
    this.ui.puts("{h1}📁 Try Directory Selection");
    this.ui.puts(`{dim_text}${separator}`);
    this.ui.puts(`{highlight}Search: {reset}${this.inputBuffer}`);
    this.ui.puts(`{dim_text}${separator}`);
    const maxVisible = Math.max(termHeight - 8, 3);
    const totalItems = tries.length + 1;
    if (this.cursorPos < this.scrollOffset) {
      this.scrollOffset = this.cursorPos;
    } else if (this.cursorPos >= this.scrollOffset + maxVisible) {
      this.scrollOffset = this.cursorPos - maxVisible + 1;
    }
    const visibleEnd = Math.min(this.scrollOffset + maxVisible, totalItems);
    for (let idx = this.scrollOffset; idx < visibleEnd; idx++) {
      if (
        idx === tries.length &&
        tries.length > 0 &&
        idx >= this.scrollOffset
      ) {
        this.ui.puts();
      }
      const isSelected = idx === this.cursorPos;
      this.ui.print(isSelected ? "{highlight}→ {reset_fg}" : "  ");
      if (idx < tries.length) {
        const t = tries[idx];
        this.ui.print("📁 ");
        if (isSelected) this.ui.print("{start_selected}");
        let displayText = "";
        const m = t.basename.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
        if (m) {
          const datePart = m[1];
          const namePart = m[2];
          this.ui.print(`{dim_text}${datePart}{reset_fg}`);
          const separatorMatches =
            this.inputBuffer && this.inputBuffer.includes("-");
          if (separatorMatches) {
            this.ui.print("{highlight}-{reset_fg}");
          } else {
            this.ui.print("{dim_text}-{reset_fg}");
          }
          if (this.inputBuffer && this.inputBuffer.length > 0) {
            this.ui.print(
              this.highlightMatchesForSelection(
                namePart,
                this.inputBuffer,
                isSelected
              )
            );
          } else {
            this.ui.print(namePart);
          }
          displayText = `${datePart}-${namePart}`;
        } else {
          if (this.inputBuffer && this.inputBuffer.length > 0) {
            this.ui.print(
              this.highlightMatchesForSelection(
                t.basename,
                this.inputBuffer,
                isSelected
              )
            );
          } else {
            this.ui.print(t.basename);
          }
          displayText = t.basename;
        }
        const timeText = this.formatRelativeTime(t.mtime);
        const scoreText = t.score.toFixed(1);
        const metaText = `${timeText}, ${scoreText}`;
        const metaWidth = metaText.length + 1;
        const textWidth = displayText.length;
        const paddingNeeded = termWidth - 5 - textWidth - metaWidth;
        const padding = " ".repeat(Math.max(paddingNeeded, 1));
        this.ui.print(padding);
        if (isSelected) this.ui.print("{end_selected}");
        this.ui.print(` {dim_text}${metaText}{reset_fg}`);
      } else {
        this.ui.print("+ ");
        if (isSelected) this.ui.print("{start_selected}");
        const displayText =
          this.inputBuffer && this.inputBuffer.length > 0
            ? `Create new: ${this.inputBuffer}`
            : "Create new";
        this.ui.print(displayText);
        const textWidth = displayText.length;
        const paddingNeeded = termWidth - 5 - textWidth;
        this.ui.print(" ".repeat(Math.max(paddingNeeded, 1)));
      }
      this.ui.puts();
    }
    if (totalItems > maxVisible) {
      this.ui.puts(`{dim_text}${separator}`);
      this.ui.puts(
        `{dim_text}[${this.scrollOffset + 1}-${visibleEnd}/${totalItems}]`
      );
    }
    this.ui.puts(`{dim_text}${separator}`);
    if (this.deleteStatus) {
      this.ui.puts(`{highlight}${this.deleteStatus}{reset}`);
      this.deleteStatus = null;
    } else {
      this.ui.puts(
        "{dim_text}↑↓/Ctrl-P,N,J,K: Navigate  Enter: Select  Ctrl-D: Delete  ESC: Cancel{reset}"
      );
    }
    this.ui.flush();
  }

  formatRelativeTime(time: Date): string {
    if (!time) return "?";
    const seconds = (Date.now() - time.getTime()) / 1000;
    const minutes = seconds / 60;
    const hours = minutes / 60;
    const days = hours / 24;
    if (seconds < 10) return "just now";
    if (minutes < 60) return `${Math.trunc(minutes)}m ago`;
    if (hours < 24) return `${Math.trunc(hours)}h ago`;
    if (days < 30) return `${Math.trunc(days)}d ago`;
    if (days < 365) return `${Math.trunc(days / 30)}mo ago`;
    return `${Math.trunc(days / 365)}y ago`;
  }

  highlightMatches(text: string, query: string): string {
    if (!query || query.length === 0) return text;
    let result = "";
    const textLower = text.toLowerCase();
    const queryLower = query.toLowerCase();
    const qchars = Array.from(queryLower);
    let qidx = 0;
    for (let i = 0; i < text.length; i++) {
      if (qidx < qchars.length && textLower[i] === qchars[qidx]) {
        result += `{highlight}${text[i]}{text}`;
        qidx += 1;
      } else {
        result += text[i];
      }
    }
    return result;
  }

  highlightMatchesForSelection(text: string, query: string, isSelected: boolean): string {
    if (!query || query.length === 0) return text;
    let result = "";
    const textLower = text.toLowerCase();
    const queryLower = query.toLowerCase();
    const qchars = Array.from(queryLower);
    let qidx = 0;
    for (let i = 0; i < text.length; i++) {
      if (qidx < qchars.length && textLower[i] === qchars[qidx]) {
        result += `{highlight}${text[i]}{text}`;
        qidx += 1;
      } else {
        result += text[i];
      }
    }
    return result;
  }

  handleSelection(tryDir: TryEntry) {
    this.selected = { type: "cd", path: tryDir.path };
  }

  async handleCreateNew() {
    const datePrefix = new Date().toISOString().slice(0, 10);
    if (this.inputBuffer && this.inputBuffer.length > 0) {
      const finalName = `${datePrefix}-${this.inputBuffer}`.replace(
        /\s+/g,
        "-"
      );
      const fullPath = path.join(this.basePath, finalName);
      this.selected = { type: "mkdir", path: fullPath };
      return;
    }
    this.ui.cls();
    this.ui.puts("{h2}Enter the name");
    this.ui.puts();
    this.ui.puts(`> {dim_text}${datePrefix}-{reset}`);
    this.ui.flush();
    safeStderrWrite("\x1b[?25h");
    const entry = await this.readLineOnce();
    if (!entry) {
      this.selected = { type: "cancel", path: null };
      return;
    }
    const finalName = `${datePrefix}-${entry}`.replace(/\s+/g, "-");
    const fullPath = path.join(this.basePath, finalName);
    this.selected = { type: "mkdir", path: fullPath };
  }

  async handleDelete(tryDir: TryEntry) {
    let size = "???";
    let files = "???";
    try {
      size = cp
        .execSync(`du -sh '${tryDir.path.replace(/'/g, `'\\''`)}'`, {
          stdio: ["ignore", "pipe", "ignore"],
        })
        .toString()
        .trim()
        .split(/\s+/)[0];
    } catch {}
    try {
      files = cp
        .execSync(
          `find '${tryDir.path.replace(/'/g, `'\\''`)}' -type f | wc -l`,
          { shell: "/bin/sh", stdio: ["ignore", "pipe", "ignore"] }
        )
        .toString()
        .trim()
        .split(/\s+/)[0];
    } catch {}
    this.ui.cls();
    this.ui.puts("{h2}Delete Directory");
    this.ui.puts();
    this.ui.puts(
      `Are you sure you want to delete: {highlight}${tryDir.basename}{reset}`
    );
    this.ui.puts(`  {dim_text}in ${tryDir.path}{reset}`);
    this.ui.puts(`  {dim_text}files: ${files} files{reset}`);
    this.ui.puts(`  {dim_text}size: ${size}{reset}`);
    this.ui.flush();
    safeStderrWrite("\x1b[?25h");
    let confirmation = "";
    if (this.testConfirm != null || !process.stderr.isTTY) {
      confirmation = String(
        this.testConfirm || (await this.readLineOnceStdIn())
      ).trim();
    } else {
      const prompt = process.stderr.isTTY
        ? UI.expandTokens(
            "{highlight}Type {text}YES{highlight} or {text}Y{highlight} to confirm: {reset}"
          )
        : "Type YES or Y to confirm: ";
      confirmation = String(await this.readLineOnce(prompt)).trim();
    }
    Debug.log(
      this,
      "delete_confirm",
      `path=${tryDir.path}`,
      `entered="${confirmation}"`
    );
    const conf = confirmation ? confirmation.trim().toUpperCase() : "";
    if (conf === "YES" || conf === "Y") {
      try {
        const cwd = process.cwd();
        fs.rmSync(tryDir.path, { recursive: true, force: true });
        this.deleteStatus = `Deleted: ${tryDir.basename}`;
        this.allTries = null;
        // If current working directory is inside the deleted directory, request chdir to base on exit
        try {
          const rel = path.relative(tryDir.path, cwd);
          const isInside =
            cwd === tryDir.path ||
            (rel && !rel.startsWith("..") && !path.isAbsolute(rel));
          Debug.log(
            this,
            "post_delete",
            `cwd=${cwd}`,
            `deleted=${tryDir.path}`,
            `rel=${rel}`,
            `isInside=${String(isInside)}`
          );
          if (isInside) {
            this.selected = {
              type: "restart",
              // cd back to base path
              path: this.basePath,
            };
          }
        } catch (e) {}
      } catch (e: any) {
        this.deleteStatus = `Error: ${e.message}`;
      }
    } else {
      this.deleteStatus = "Delete cancelled";
    }
    safeStderrWrite("\x1b[?25l");
  }

  async readLineOnce(prompt: string = ""): Promise<string> {
    // Temporarily disable raw mode, read from tty
    const wasRaw = process.stdin.isTTY ? process.stdin.isRaw : false;
    try {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
    } catch {}
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true,
      historySize: 0,
    });
    const line = await new Promise<string>((resolve) =>
      rl.question(prompt, (ans) => resolve(ans))
    );
    rl.close();
    try {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(wasRaw);
        // After the delete confirmation, readLineOnce leaves stdin paused,
        // so when render(tries) finishes there are no active I/O handles
        // and Node exits before the next readKey.
        // We need to explicitly re‑arm stdin for raw key input.
        process.stdin.resume();
      }
    } catch {}
    return line;
  }

  async readLineOnceStdIn(): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: false,
    });
    const line = await new Promise<string>((resolve) =>
      rl.once("line", (l) => resolve(l))
    );
    rl.close();
    return line;
  }
}

class HelpPrinter {
  static printGlobalHelp() {
    const text = `{h1}try something!{reset}

Lightweight experiments for people with ADHD

this tool is not meant to be used directly,
but added to your ~/.zshrc or ~/.bashrc:

  {highlight}eval "$(#$0 init ~/workspaces/tries)"{reset}

for fish shell, add to ~/.config/fish/config.fish:

  {highlight}eval (#$0 init ~/workspaces/tries | string collect){reset}

{h2}Usage:{text}

  init [--path PATH]  # Initialize shell function for aliasing
  cd [QUERY] [name?]  # Interactive selector; Git URL shorthand supported
  clone <git-uri> [name]  # Clone git repo into date-prefixed directory
  worktree dir [name]  # Create date-prefixed dir; add worktree from CWD if git repo
  worktree <repo-path> [name]  # Same as above, but source repo is <repo-path>

{h2}Clone Examples:{text}

  try clone https://github.com/tobi/try.git
  # Creates: 2025-08-27-tobi-try

  try clone https://github.com/tobi/try.git my-fork
  # Creates: my-fork

  try https://github.com/tobi/try.git
  # Shorthand for clone (same as first example)

{h2}Worktree Examples:{text}

  try worktree dir
  # From current git repo, creates: 2025-08-27-repo-name and adds detached worktree

  try worktree ~/src/github.com/tobi/try my-branch
  # From given repo path, creates: 2025-08-27-my-branch and adds detached worktree

{h2}Defaults:{reset}
  Default path: {dim_text}~/workspaces/tries{reset} (override with --path on commands)
  Current default: {dim_text}${TrySelector.TRY_PATH}{reset}
`;
    const out = process.stdout.isTTY
      ? UI.expandTokens(text)
      : text.replace(/\{.*?\}/g, "");
    process.stdout.write(out);
  }
}

class TestKeyParser {
  static parse(spec: string | null): string[] | null {
    if (!spec || spec.length === 0) return null;
    const tokens = spec.split(/,\s*/);
    const keys: string[] = [];
    for (const tok0 of tokens) {
      const tok = tok0.toUpperCase();
      switch (tok) {
        case "UP":
          keys.push("\x1b[A");
          break;
        case "DOWN":
          keys.push("\x1b[B");
          break;
        case "LEFT":
          keys.push("\x1b[D");
          break;
        case "RIGHT":
          keys.push("\x1b[C");
          break;
        case "ENTER":
          keys.push("\r");
          break;
        case "ESC":
          keys.push("\x1b");
          break;
        case "BACKSPACE":
          keys.push("\x7F");
          break;
        case "CTRL-D":
        case "CTRLD":
          keys.push("\x04");
          break;
        case "CTRL-P":
        case "CTRLP":
          keys.push("\x10");
          break;
        case "CTRL-N":
        case "CTRLN":
          keys.push("\x0E");
          break;
        case "CTRL-J":
        case "CTRLJ":
          keys.push("\n");
          break;
        case "CTRL-K":
        case "CTRLK":
          keys.push("\x0B");
          break;
        default:
          if (/^TYPE=(.*)$/.test(tok0)) {
            const s = tok0.replace(/^TYPE=/i, "");
            for (const ch of s) keys.push(ch);
          } else if (tok.length === 1) {
            keys.push(tok0);
          }
      }
    }
    return keys;
  }
}

class ArgsParser {
  args: string[];
  command: string | null;
  triesPath: string | null;
  andType: string | null;
  andExit: boolean;
  andKeys: string[] | null;
  andConfirm: string | null;
  debug: boolean;

  constructor(argv: string[]) {
    this.args = argv.slice(2);
    this.command = null;
    this.triesPath = null;
    this.andType = null;
    this.andExit = false;
    this.andKeys = null;
    this.andConfirm = null;
    this.debug = false;
  }

  static extractOptionWithValue(args: string[], optName: string): string | null {
    const i = [...args]
      .reverse()
      .findIndex((a) => a === optName || a.startsWith(`${optName}=`));
    if (i === -1) return null;
    const forwardIdx = args.length - 1 - i;
    const arg = args.splice(forwardIdx, 1)[0];
    if (arg.includes("=")) {
      return arg.split("=", 2)[1];
    } else {
      return args.splice(forwardIdx, 1)[0] || null;
    }
  }

  static removeFlag(args: string[], flag: string): boolean {
    const idx = args.indexOf(flag);
    if (idx >= 0) {
      args.splice(idx, 1);
      return true;
    }
    return false;
  }

  parse(): ArgsParser {
    this.triesPath =
      ArgsParser.extractOptionWithValue(this.args, "--path") ||
      TrySelector.TRY_PATH;
    this.command = this.args.shift() || null;
    this.andType = ArgsParser.extractOptionWithValue(this.args, "--and-type");
    this.andExit = ArgsParser.removeFlag(this.args, "--and-exit");
    this.debug = ArgsParser.removeFlag(this.args, "--debug");
    const andKeysRaw = ArgsParser.extractOptionWithValue(
      this.args,
      "--and-keys"
    );
    this.andKeys = TestKeyParser.parse(andKeysRaw);
    this.andConfirm = ArgsParser.extractOptionWithValue(
      this.args,
      "--and-confirm"
    );
    return this;
  }
}

class GitUtils {
  static parseGitUri(uri: string): { user: string; repo: string; host: string } | null {
    uri = uri.replace(/\.git$/, "");
    let m;
    if ((m = uri.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)/))) {
      return { user: m[1], repo: m[2], host: "github.com" };
    } else if ((m = uri.match(/^git@github\.com:([^/]+)\/([^/]+)/))) {
      return { user: m[1], repo: m[2], host: "github.com" };
    } else if ((m = uri.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)/))) {
      return { host: m[1], user: m[2], repo: m[3] };
    } else if ((m = uri.match(/^git@([^:]+):([^/]+)\/([^/]+)/))) {
      return { host: m[1], user: m[2], repo: m[3] };
    } else {
      return null;
    }
  }

  static generateCloneDirectoryName(gitUri: string, customName?: string): string | null {
    if (customName && customName.length > 0) return customName;
    const parsed = GitUtils.parseGitUri(gitUri);
    if (!parsed) return null;
    const datePrefix = new Date().toISOString().slice(0, 10);
    return `${datePrefix}-${parsed.user}-${parsed.repo}`;
  }

  static isGitUri(arg: string | null): boolean {
    if (!arg) return false;
    return (
      /^(https?:\/\/|git@)/.test(arg) ||
      arg.includes("github.com") ||
      arg.includes("gitlab.com") ||
      arg.endsWith(".git")
    );
  }
}

class PathUtils {
  static uniqueDirName(triesPath: string, dirName: string): string {
    let candidate = dirName;
    let i = 2;
    while (fs.existsSync(path.join(triesPath, candidate))) {
      candidate = `${dirName}-${i}`;
      i += 1;
    }
    return candidate;
  }

  static resolveUniqueNameWithVersioning(triesPath: string, datePrefix: string, base: string): string {
    const initial = `${datePrefix}-${base}`;
    if (!fs.existsSync(path.join(triesPath, initial))) return base;
    const m = base.match(/^(.*?)(\d+)$/);
    if (m) {
      const stem = m[1];
      let n = parseInt(m[2], 10);
      let candidateNum = n + 1;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const candidateBase = `${stem}${candidateNum}`;
        const candidateFull = path.join(
          triesPath,
          `${datePrefix}-${candidateBase}`
        );
        if (!fs.existsSync(candidateFull)) return candidateBase;
        candidateNum += 1;
      }
    } else {
      const unique = PathUtils.uniqueDirName(
        triesPath,
        `${datePrefix}-${base}`
      );
      return unique.replace(new RegExp(`^${datePrefix}-`), "");
    }
  }
}

class Shell {
  static isFish() {
    return (process.env.SHELL || "").includes("fish");
  }
}

class InitScript {
  static bashOrZsh(scriptPath: string, pathArg: string) {
    return `try() {
  script_path='${scriptPath}'
  case "$1" in
    clone|worktree|init|new)
      cmd=$(/usr/bin/env node "$script_path"${pathArg} "$@" 2>/dev/tty)
      ;;
    *)
      cmd=$(/usr/bin/env node "$script_path" cd${pathArg} "$@" 2>/dev/tty)
      ;;
  esac
  rc=$?
  if [ $rc -eq ${EXIT_EVAL} ]; then
    eval "$cmd"
  else
    printf %s "$cmd"
  fi
}
`;
  }

  static fish(scriptPath: string, pathArg: string) {
    return `function try
  set -l script_path "${scriptPath}"
  switch $argv[1]
    case clone worktree init new
      set -l cmd (/usr/bin/env node "$script_path"${pathArg} $argv 2>/dev/tty | string collect)
    case '*'
      set -l cmd (/usr/bin/env node "$script_path" cd${pathArg} $argv 2>/dev/tty | string collect)
  end
  set -l rc $status
  if test $rc -eq ${EXIT_EVAL}
    eval $cmd
  else
    printf %s $cmd
  end
end
`;
  }
}

interface Task {
  type: string;
  path?: string;
  msg?: string;
  uri?: string;
  repo?: string;
}

class TaskScriptEmitter {
  static joinCommands(parts: string[]) {
    return parts.join(" \\\n  && ");
  }

  static emitScript(parts: string[]) {
    process.stdout.write(TaskScriptEmitter.joinCommands(parts));
  }

  static emitTasksScript(tasks: Task[]) {
    const target = tasks.find((t) => t.type === "target");
    const fullPath = target && target.path;
    if (!fullPath) throw new Error("emit_tasks_script requires a target path");
    const parts: string[] = [];
    const q = `'${fullPath.replace(/'/g, `'\\''`)}'`;
    for (const t of tasks) {
      switch (t.type) {
        case "echo": {
          const msg = t.msg || "";
          const expanded = UI.expandTokens(msg);
          const m = `'${expanded.replace(/'/g, `'\\''`)}'`;
          parts.push(`echo ${m}`);
          break;
        }
        case "mkdir":
          parts.push(`mkdir -p ${q}`);
          break;
        case "git-clone":
          parts.push(
            `git clone '${(t.uri || "").replace(/'/g, `'\\''`)}' ${q}`
          );
          break;
        case "git-worktree": {
          if (t.repo) {
            const r = `'${t.repo.replace(/'/g, `'\\''`)}'`;
            parts.push(
              `/usr/bin/env sh -c 'if git -C ${r} rev-parse --is-inside-work-tree >/dev/null 2>&1; then repo=$(git -C ${r} rev-parse --show-toplevel); git -C "$repo" worktree add --detach ${q} >/dev/null 2>&1 || true; fi; exit 0'`
            );
          } else {
            parts.push(
              `/usr/bin/env sh -c 'if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then repo=$(git rev-parse --show-toplevel); git -C "$repo" worktree add --detach ${q} >/dev/null 2>&1 || true; fi; exit 0'`
            );
          }
          break;
        }
        case "touch":
          parts.push(`touch ${q}`);
          break;
        case "cd":
          parts.push(`cd ${q}`);
          break;
        case "restart":
          parts.push(`try`);
          break;
      }
    }
    if (parts.length > 0) {
      TaskScriptEmitter.emitScript(parts);
      return exit(EXIT_EVAL);
    } else {
      exit(0);
    }
  }
}

class Commands {
  triesPath: string;

  constructor(triesPath: string, debugEnabled: boolean) {
    this.triesPath = triesPath;
  }

  clone(args: string[]): Task[] {
    const gitUri = args.shift();
    const customName = args.shift();
    if (!gitUri) {
      console.error("Error: git URI required for clone command");
      console.error("Usage: try clone <git-uri> [name]");
      exit(1);
      return [];
    }
    const dirName = GitUtils.generateCloneDirectoryName(gitUri, customName);
    if (!dirName) {
      console.error(`Error: Unable to parse git URI: ${gitUri}`);
      exit(1);
      return [];
    }
    const fullPath = path.join(this.triesPath, dirName);
    return [
      { type: "target", path: fullPath },
      { type: "mkdir" },
      {
        type: "echo",
        msg: `Using {highlight}git clone{reset_fg} to create this trial from ${gitUri}.`,
      },
      { type: "git-clone", uri: gitUri },
      { type: "touch" },
      { type: "cd" },
    ];
  }

  init(args: string[]) {
    let triesPath = this.triesPath;
    const scriptPath = path.resolve(process.argv[1]);
    if (args[0] && args[0].startsWith("/")) {
      triesPath = path.resolve(args.shift()!);
    }
    const pathArg = triesPath ? ` --path "${triesPath}"` : "";
    const script = Shell.isFish()
      ? InitScript.fish(scriptPath, pathArg)
      : InitScript.bashOrZsh(scriptPath, pathArg);
    process.stdout.write(script);
    exit(0);
  }

  new(args: string[]): Task[] {
    const customName = args.join(" ").trim();
    const base = customName.length > 0
      ? customName.replace(/\s+/g, "-")
      : RandomName.generate();
    const datePrefix = new Date().toISOString().slice(0, 10);
    const resolvedBase = PathUtils.resolveUniqueNameWithVersioning(
      this.triesPath,
      datePrefix,
      base
    );
    const dirName = `${datePrefix}-${resolvedBase}`;
    const fullPath = path.join(this.triesPath, dirName);
    return [
      { type: "target", path: fullPath },
      { type: "mkdir" },
      { type: "touch" },
      { type: "cd" },
    ];
  }

  worktree(args: string[]) {
    const sub = args.shift();
    if (sub == null || sub === "dir") {
      const custom = args.join(" ");
      let base;
      if (custom && custom.trim().length > 0) {
        base = custom.replace(/\s+/g, "-");
      } else {
        try {
          base = path.basename(fs.realpathSync(process.cwd()));
        } catch {
          base = path.basename(process.cwd());
        }
      }
      const datePrefix = new Date().toISOString().slice(0, 10);
      base = PathUtils.resolveUniqueNameWithVersioning(
        this.triesPath,
        datePrefix,
        base
      );
      const dirName = `${datePrefix}-${base}`;
      const fullPath = path.join(this.triesPath, dirName);
      const tasks: Task[] = [{ type: "target", path: fullPath }, { type: "mkdir" }];
      if (fs.existsSync(path.join(process.cwd(), ".git"))) {
        tasks.push({
          type: "echo",
          msg: `Using {highlight}git worktree{reset_fg} to create this trial from ${process.cwd()}.`,
        });
        tasks.push({ type: "git-worktree" });
      }
      tasks.push({ type: "touch" }, { type: "cd" });
      TaskScriptEmitter.emitTasksScript(tasks);
    } else {
      const repoDir = path.resolve(sub);
      const custom = args.join(" ");
      let base;
      if (custom && custom.trim().length > 0) {
        base = custom.replace(/\s+/g, "-");
      } else {
        try {
          base = path.basename(fs.realpathSync(repoDir));
        } catch {
          base = path.basename(repoDir);
        }
      }
      const datePrefix = new Date().toISOString().slice(0, 10);
      base = PathUtils.resolveUniqueNameWithVersioning(
        this.triesPath,
        datePrefix,
        base
      );
      const dirName = `${datePrefix}-${base}`;
      const fullPath = path.join(this.triesPath, dirName);
      const tasks: Task[] = [{ type: "target", path: fullPath }, { type: "mkdir" }];
      tasks.push({
        type: "echo",
        msg: `Using {highlight}git worktree{reset_fg} to create this trial from ${repoDir}.`,
      });
      tasks.push({ type: "git-worktree", repo: repoDir });
      tasks.push({ type: "touch" }, { type: "cd" });
      TaskScriptEmitter.emitTasksScript(tasks);
    }
  }

  async cd(args: string[], andType: string | null, andExit: boolean, andKeys: string[] | null, andConfirm: string | null): Promise<Task[] | null | void> {
    Debug.log(
      this,
      "cd_command",
      "args=" + JSON.stringify(args),
      "andType=" + JSON.stringify(andType),
      "andExit=" + JSON.stringify(andExit),
      "andKeys=" + JSON.stringify(andKeys),
      "andConfirm=" + JSON.stringify(andConfirm)
    );
    if (args[0] === "clone") {
      return this.clone(args.slice(1));
    }
    if (args[0] && args[0].startsWith(".")) {
      const pathArg = args.shift()!;
      const custom = args.join(" ");
      const repoDir = path.resolve(pathArg);
      const base =
        custom && custom.trim().length > 0
          ? custom.replace(/\s+/g, "-")
          : path.basename(repoDir);
      const datePrefix = new Date().toISOString().slice(0, 10);
      const resolvedBase = PathUtils.resolveUniqueNameWithVersioning(
        this.triesPath,
        datePrefix,
        base
      );
      const dirName = `${datePrefix}-${resolvedBase}`;
      const fullPath = path.join(this.triesPath, dirName);
      const tasks: Task[] = [{ type: "target", path: fullPath }, { type: "mkdir" }];
      if (fs.existsSync(path.join(repoDir, ".git"))) {
        tasks.push({
          type: "echo",
          msg: `Using {highlight}git worktree{reset_fg} to create this trial from ${repoDir}.`,
        });
        tasks.push({ type: "git-worktree", repo: repoDir });
      }
      tasks.push({ type: "touch" }, { type: "cd" });
      return tasks;
    }
    const searchTerm = args.join(" ");
    if (GitUtils.isGitUri(searchTerm.split(/\s+/)[0])) {
      const [gitUri, customName] = searchTerm.split(/\s+/, 2);
      const dirName = GitUtils.generateCloneDirectoryName(gitUri, customName);
      if (!dirName) {
        console.error(`Error: Unable to parse git URI: ${gitUri}`);
        exit(1);
        return
      }
      const fullPath = path.join(this.triesPath, dirName);
      return [
        { type: "target", path: fullPath },
        { type: "mkdir" },
        {
          type: "echo",
          msg: `Using {highlight}git clone{reset_fg} to create this trial from ${gitUri}.`,
        },
        { type: "git-clone", uri: gitUri },
        { type: "touch" },
        { type: "cd" },
      ];
    }
    const selector = new TrySelector(searchTerm, {
      basePath: this.triesPath,
      initialInput: andType,
      testRenderOnce: !!andExit,
      testNoCls: !!(andExit || (andKeys && andKeys.length > 0)),
      testKeys: andKeys,
      testConfirm: andConfirm,
    });
    if (andExit) {
      return selector.run().then(() => {
        Debug.log(this, "exit_from_selector", "andExit=true");
        exit(0);
      });
    }
    return selector.run().then((result) => {
      if (!result) {
        Debug.log(this, "emit_tasks_from_selection", "no result");
        return null;
      }
      Debug.log(this, "emit_tasks_from_selection", JSON.stringify(result));
      const tasks: Task[] = [{ type: "target", path: result.path! }];
      if (result.type === "mkdir") tasks.push({ type: "mkdir" });
      tasks.push({ type: "touch" }, { type: "cd" });
      if (result.type === "restart") tasks.push({ type: "restart" });
      return tasks;
    });
  }
}

class TryApp {
  argv: string[];
  parsed: ArgsParser;

  constructor(argv: string[]) {
    this.argv = argv;
    const parser = new ArgsParser(argv);
    this.parsed = parser.parse();
    Debug.init(this.parsed.debug);
  }

  async run() {
    if (this.argv.includes("--help") || this.argv.includes("-h")) {
      HelpPrinter.printGlobalHelp();
      exit(0);
    }
    const parsed = this.parsed;
    Debug.log(this, "app_start", JSON.stringify(this.argv));
    Debug.log(
      this,
      "parsed",
      `cmd=${parsed.command}`,
      `triesPath=${parsed.triesPath}`,
      `debug=${String(parsed.debug)}`
    );
    const triesPath = path.resolve(parsed.triesPath!);
    const commands = new Commands(triesPath, parsed.debug);
    if (parsed.command == null) {
      HelpPrinter.printGlobalHelp();
      exit(2);
    }
    switch (parsed.command) {
      case "clone": {
        const tasks = commands.clone(parsed.args);
        TaskScriptEmitter.emitTasksScript(tasks);
        break;
      }
      case "init": {
        commands.init(parsed.args);
        break;
      }
      case "new": {
        const tasks = commands.new(parsed.args);
        TaskScriptEmitter.emitTasksScript(tasks);
        break;
      }
      case "worktree": {
        commands.worktree(parsed.args);
        break; // worktree exits internally
      }
      case "cd": {
        const tasksMaybe = commands.cd(
          parsed.args,
          parsed.andType,
          parsed.andExit,
          parsed.andKeys,
          parsed.andConfirm
        );
        const tasks =
          tasksMaybe instanceof Promise ? await tasksMaybe : tasksMaybe;
        if (tasks) TaskScriptEmitter.emitTasksScript(tasks);
        break;
      }
      case "debug": {
        Debug.callout();
        exit(0);
        break;
      }
      default: {
        console.error(`Unknown command: ${parsed.command}`);
        HelpPrinter.printGlobalHelp();
        exit(2);
      }
    }
  }
}

async function main() {
  const app = new TryApp(process.argv);
  safeStderrWrite('\x1b[?1049h');
  await app.run();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Ensure default path exists if used later by commands
  try {
    const p = TrySelector.TRY_PATH;
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  } catch {}
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    exit(1);
  });
}
