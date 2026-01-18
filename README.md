# try - fresh directories for every vibe

*Your experiments deserve a home.* 🏠

> For everyone who constantly creates new projects for little experiments, a tiny one-file CLI to quickly manage and navigate them so they stay somewhat organized.

Ever find yourself with 50 directories named `test`, `test2`, `new-test`, `actually-working-test`, scattered across your filesystem? Or worse, just coding in `/tmp` and losing everything?

**try** is here for your beautifully chaotic mind.

# What it does 

[![asciicast](https://asciinema.org/a/ve8AXBaPhkKz40YbqPTlVjqgs.svg)](https://asciinema.org/a/ve8AXBaPhkKz40YbqPTlVjqgs)

Instantly navigate through all your experiment directories with:
- **Fuzzy search** that just works
- **Smart sorting** - recently used stuff bubbles to the top
- **Auto-dating** - creates directories like `2025-08-17-redis-experiment`
- **Zero config** - just one Ruby file, no dependencies

## Quick Start (Node.js, this repo)

```bash
# Clone this fork
git clone https://github.com/taoalpha/try.git ~/src/try-node
cd ~/src/try-node

# Make the script executable
chmod +x try.js

# Add to your shell (bash/zsh)
echo 'eval "$(/usr/bin/env node ~/src/try-node/try.js init ~/src/tries)"' >> ~/.zshrc

# for fish shell users
echo 'eval (/usr/bin/env node ~/src/try-node/try.js init ~/src/tries | string collect)' >> ~/.config/fish/config.fish
```

## The Problem

You're learning Redis. You create `/tmp/redis-test`. Then `~/Desktop/redis-actually`. Then `~/projects/testing-redis-again`. Three weeks later you can't find that brilliant connection pooling solution you wrote at 2am.

## The Solution

All your experiments in one place, with instant fuzzy search:

```bash
$ try pool
→ 2025-08-14-redis-connection-pool    2h, 18.5
  2025-08-03-thread-pool              3d, 12.1
  2025-07-22-db-pooling               2w, 8.3
  + Create new: pool
```

Type, arrow down, enter. You're there.

## Features

### 🎯 Smart Fuzzy Search
Not just substring matching - it's smart:
- `rds` matches `redis-server`
- `connpool` matches `connection-pool`
- Recent stuff scores higher
- Shorter names win on equal matches

### ⏰ Time-Aware
- Shows how long ago you touched each project
- Recently accessed directories float to the top
- Perfect for "what was I working on yesterday?"

### 🎨 Pretty TUI
- Clean, minimal interface
- Highlights matches as you type
- Shows scores so you know why things are ranked
- Dark mode by default (because obviously)

### 📁 Organized Chaos
- Everything lives in `~/src/tries` (configurable via `TRY_PATH`)
- Auto-prefixes with dates: `2025-08-17-your-idea`
- Skip the date prompt if you already typed a name

### Shell Integration

Once `try.js` is on disk, `try init` installs a small shell wrapper:

- Bash/Zsh:

  ```bash
  # default is ~/src/tries
  eval "$(/usr/bin/env node ~/src/try-node/try.js init)"
  # or pick a path
  eval "$(/usr/bin/env node ~/src/try-node/try.js init ~/src/tries)"
  ```

- Fish:

  ```fish
  eval (/usr/bin/env node ~/src/try-node/try.js init | string collect)
  # or pick a path
  eval (/usr/bin/env node ~/src/try-node/try.js init ~/src/tries | string collect)
  ```

Notes:
- The runtime commands printed by `try` are shell-neutral (absolute paths, quoted). Only the small wrapper function differs per shell.

## Usage

```bash
try                                          # Browse all experiments
try redis                                    # Jump to redis experiment or create new
try new                                      # Create with random name (e.g., "2025-08-17-swift-fox")
try new api                                  # Create with custom name "2025-08-17-api"
try . [name]                                   # Create a dated worktree dir for current repo
try ./path/to/repo [name]                      # Use another repo as the worktree source
try worktree dir [name]                        # Same as above, explicit CLI form
try clone https://github.com/user/repo.git  # Clone repo into date-prefixed directory
try https://github.com/user/repo.git        # Shorthand for clone (same as above)
try --help                                   # See all options
```

### Non-Interactive Mode

The `try new` command works without a TTY, making it perfect for scripts and automation:

```bash
# Create a random experiment directory (no TTY required)
try new
# Creates: 2025-08-17-swift-fox (random adjective-noun)

# Create with a specific name
try new my-experiment
# Creates: 2025-08-17-my-experiment
```

Notes on worktrees (`try .` / `try worktree dir`):
- With a custom [name], uses that; otherwise uses cwd’s basename. Both are prefixed with today’s date.
- Inside a Git repo: adds a detached HEAD git worktree to the created directory.
- Outside a repo: simply creates the directory and changes into it.

### Git Repository Cloning

**try** can automatically clone git repositories into properly named experiment directories:

```bash
# Clone with auto-generated directory name
try clone https://github.com/taoalpha/try.git
# Creates: 2025-08-27-taoalpha-try

# Clone with custom name
try clone https://github.com/taoalpha/try.git my-fork
# Creates: my-fork

# Shorthand syntax (no need to type 'clone')
try https://github.com/taoalpha/try.git
# Creates: 2025-08-27-taoalpha-try
```

Supported git URI formats:
- `https://github.com/user/repo.git` (HTTPS GitHub)
- `git@github.com:user/repo.git` (SSH GitHub)
- `https://gitlab.com/user/repo.git` (GitLab)
- `git@host.com:user/repo.git` (SSH other hosts)

The `.git` suffix is automatically removed from URLs when generating directory names.

### Keyboard Shortcuts

- `↑/↓` or `Ctrl-P/N/J/K` - Navigate
- `Enter` - Select or create
- `Backspace` - Delete character
- `Ctrl-D` - Delete directory (with confirmation)
- `ESC` - Cancel
- Just type to filter

## Configuration

Set `TRY_PATH` to change where experiments are stored:

```bash
export TRY_PATH=~/code/sketches
```

Default: `~/src/tries`

## Why Node.js?

- One file, no external dependencies beyond a recent Node.js.
- Easy to run and hack locally (`node try.js`).
- Still fast enough for thousands of directories.

## The Philosophy

Your brain doesn't work in neat folders. You have ideas, you try things, you context-switch like a caffeinated squirrel. This tool embraces that.

Every experiment gets a home. Every home is instantly findable. Your 2am coding sessions are no longer lost to the void.

## FAQ

**Q: Why not just use `cd` and `ls`?**
A: Because you have 200 directories and can't remember if you called it `test-redis`, `redis-test`, or `new-redis-thing`.

**Q: Why not use `fzf`?**
A: fzf is great for files. This is specifically for project directories, with time-awareness and auto-creation built in.

**Q: Can I use this for real projects?**
A: You can, but it's designed for experiments. Real projects deserve real names in real locations.

**Q: What if I have thousands of experiments?**
A: First, welcome to the club. Second, it handles it fine - the scoring algorithm ensures relevant stuff stays on top.

## Contributing

It's one file. If you want to change something, just edit it. Send a PR if you think others would like it too.

## License

MIT - Do whatever you want with it.

---

*Built for developers with ADHD by developers with ADHD.*

*Your experiments deserve a home.* 🏠
