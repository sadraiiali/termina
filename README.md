# Termina

**Interactive Linux terminal lab in the browser** — Persian course content, full-screen [xterm.js](https://xtermjs.org/), and **FakeShell**: a **TypeScript fake shell** we maintain in this repo (`src/lib/fakeshell`).

**Repository:** [https://github.com/sadraiiali/termina](https://github.com/sadraiiali/termina)  
**Live demo (GitHub Pages):** [https://sadraii.ir/termina/](https://sadraii.ir/termina/)  
(also [sadraiiali.github.io/termina](https://sadraiiali.github.io/termina/))

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](./LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-sadraiiali%2Ftermina-181717?logo=github)](https://github.com/sadraiiali/termina)
[![Pages](https://img.shields.io/badge/GitHub%20Pages-live-2ea44f?logo=github)](https://sadraii.ir/termina/)
[![Build and deploy GitHub Pages](https://github.com/sadraiiali/termina/actions/workflows/pages.yml/badge.svg)](https://github.com/sadraiiali/termina/actions/workflows/pages.yml)

> **فارسی:** محیط یادگیری ترمینال لینوکس با درس فارسی و **FakeShell** — شل جعلی نوشته‌شده با TypeScript (نه لینوکس واقعی). مناسب کلاس و خودآموزی.  
> **مخزن:** [github.com/sadraiiali/termina](https://github.com/sadraiiali/termina)  
> **نسخه آنلاین:** [sadraii.ir/termina](https://sadraii.ir/termina/)  
> **محتوای درس:** اقتباس از [AsaEdgerunner/linux-terminal-mastery](https://github.com/AsaEdgerunner/linux-terminal-mastery)

---

## پیشگفتار (Preface)

این پروژه **Termina** است: وب‌سایت و آزمایشگاه تعاملی ترمینال لینوکس (رابط فارسی، xterm.js، و FakeShell).

**از کدام پروژه برای محتوا استفاده شده؟**

| لایه | پروژه | نقش |
|------|--------|-----|
| **محتوای درس (فارسی)** | [AsaEdgerunner/linux-terminal-mastery](https://github.com/AsaEdgerunner/linux-terminal-mastery) (*Linux Terminal Mastery*) | ساختار فصول، متن آموزشی و تمرین‌های متنی — **اقتباس و استفاده در Termina** |
| **وب‌سایت و شل تعاملی** | [sadraiiali/termina](https://github.com/sadraiiali/termina) (*Termina*) | اپلیکیشن مرورگر، UI، FakeShell، ساخت و انتشار |

از نویسندگان و مشارکت‌کنندگان *Linux Terminal Mastery* برای محتوای آموزشی سپاسگزاریم. مجوز و انتساب رسمی همان مخزن را رعایت کنید.

درون خود اپ، همین پیشگفتار در فصل **پیشگفتار و مقدمه** (`static/course/fa/00-Introduction/`) هم آمده است.

---

## Overview

Termina is a **static web app** (SvelteKit). Learners read a Persian lesson and practice commands in a terminal that talks to **FakeShell** — not a remote VM or real OS.

| Layer | Role |
|--------|------|
| **UI** | Chapters, Markdown lessons, command palette, theme |
| **Terminal** | xterm.js + Fit (display / keyboard) |
| **FakeShell** | Our **TS** fake shell: VFS, builtins, fake apt/net/systemd/cron, optional WASI |
| **Course** | Persian text adapted from [Linux Terminal Mastery](https://github.com/AsaEdgerunner/linux-terminal-mastery) |

### What FakeShell is

FakeShell is **application code written in TypeScript** in this project. It *looks* like a Linux shell for teaching. It is **not** bash, **not** a kernel, and **not** Ubuntu.

| This project **is** | This project **is not** |
|---------------------|-------------------------|
| A browser lab for courses and demos | A real Linux kernel or distro |
| A TS reimplementation of common CLI patterns | Full GNU userland |
| Lab **nano** / **vim** UIs | Real GNU nano or Vim |
| Fake **apt**, **systemd**, **ip**, **cron** | Production package/service management |

---

## Features

- **Persian-first course UI** with chapter list, lesson panel, and exercises  
- **Interactive shell** over a persistent virtual filesystem (IndexedDB snapshot when available)  
- **File tools:** `ls`, `cd`, `cat`, `mkdir -p`, `cp`, `mv`, `rm`, redirects (`>`, `>>`), globs  
- **Editors:** full-screen lab **nano** and **vim** (layout and keys aimed at distro familiarity)  
- **Networking lab:** `ip`, `iptables`, `ping`, `curl` (simulated)  
- **Services lab:** `systemctl`, `journalctl`, working **crontab** ticks  
- **Packages lab:** `apt` / `apt-get` / `dpkg` (catalog + sample files, e.g. nginx configs)  
- **Syscall / WASI host:** open/read/write-style API + pilot WASM modules (`wasi-hello`, `wasi-echo`, `wasi-cat`)  
- **Webxdc build** for Delta Chat-style packages (`build:xdc`)  
- **PWA assets:** favicon, icons, `site.webmanifest`

---


---

## Deploy (GitHub Pages)

Every push to `main` runs [`.github/workflows/pages.yml`](./.github/workflows/pages.yml):

1. `bun install --frozen-lockfile`
2. `bun run check` then `bun run build` (static adapter → `build/`)
3. Deploy the artifact with GitHub Pages (`build_type: workflow`)

Manual re-run: **Actions → Build and deploy GitHub Pages → Run workflow**.

## Requirements

- [Bun](https://bun.sh/) (recommended) or a recent Node.js with a package manager  
- Modern desktop browser (Chromium / Firefox / Safari)

---

## Quick start

```bash
git clone https://github.com/sadraiiali/termina.git
cd termina

bun install
bun run dev
```

Open the URL printed by Vite (default `http://localhost:5173/`).

### Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Development server with HMR |
| `bun run build` | Production static build → `build/` |
| `bun run preview` | Preview the production build |
| `bun run check` | TypeScript + `svelte-check` |
| `bun run build:xdc` | Build and pack `dist/termina.xdc` (webxdc) |

---

## Project layout

```text
src/
  lib/
    components/     # ChapterNav, LessonPanel, XtermShell, …
    course/         # Chapter catalog & exercises
    fakeshell/      # ← TypeScript fake shell (this is FakeShell)
      fakeshell.ts  # Shell entry (FakeShell class)
      apt.ts net.ts systemd.ts cron.ts …
      sys/          # Fake syscalls + WASI pilots
  routes/
static/
  course/fa/        # Lesson Markdown (Persian)
  fonts/            # Arad, Vazir Code (OFL)
vendor/
  xterm.js/         # Terminal emulator dependency
  linux-cmds/       # Optional upstream sources (not executed)
```

---

## Lab shell (examples)

```bash
# Filesystem
mkdir -p ~/projects/final && cd ~/projects/final
echo "hello" > note.txt && cat note.txt

# Editors (lab UI)
nano note.txt
vim note.txt

# Packages (fake)
sudo apt update
sudo apt install -y nginx
cat /etc/nginx/nginx.conf

# Services & cron (fake / lab)
systemctl status ssh
crontab -l

# Syscall / WASI pilots
sys help
wasi-echo hello world
sys install-demo all
```

Try `help`, `man apt`, `man sys`, or `cat ~/TOOLS.txt` inside the lab.

---

## Architecture (short)

```text
Browser
  ├── SvelteKit UI (lessons, nav, theme)
  └── xterm.js
        └── FakeShell.run(command)   # src/lib/fakeshell — TypeScript only
              ├── VirtualFS (almostnode) ± IndexedDB
              ├── Built-in commands (TS)
              ├── SyscallKernel + WASI pilots (optional)
              └── Fake backends (net, apt, systemd, cron, ps)
```

**FakeShell is not a Linux kernel** — it is our TypeScript fake shell. All state stays in the browser.

---

## Configuration notes

- **Static adapter** — output is a static site (suitable for GitHub Pages, CDN, or webxdc zip).  
- **Relative asset paths** — configured for sandboxed / zip packaging (e.g. webxdc).  
- **`vendor/linux-cmds`** — optional bulk Linux sources for study; not required to run the app (see that folder’s README / `download.sh`).  
- **`context/`** — local workspace only; gitignored.

---

## Contributing

Issues and pull requests are welcome. Please:

1. Run `bun run check` before opening a PR.  
2. Keep lab simulations clearly documented as **fake / educational**.  
3. Do not commit secrets, `dist/`, full `vendor/linux-cmds` trees, or personal `context/` data.

---

## License

This program is free software under the **GNU General Public License v3.0 or later**.  
See [`LICENSE`](./LICENSE) for the full text.

```text
Copyright (C) 2026  the contributors

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.
```

### Third-party material

| Component | Notes |
|-----------|--------|
| Course text | Adapted from [AsaEdgerunner/linux-terminal-mastery](https://github.com/AsaEdgerunner/linux-terminal-mastery) — respect that project’s license and attribution |
| Arad / Vazir Code fonts | SIL Open Font License (see files under `static/fonts/`) |
| xterm.js, almostnode, SvelteKit, etc. | Their respective licenses (typically MIT) |

---

## Acknowledgments

- [Linux Terminal Mastery](https://github.com/AsaEdgerunner/linux-terminal-mastery) — Persian course structure and materials  
- [xterm.js](https://github.com/xtermjs/xterm.js) — terminal emulator  
- [almostnode](https://www.npmjs.com/package/almostnode) — in-browser Node-like VFS shims  
- Contributors and educators using this lab in the classroom  

---

**Termina** — learn the terminal without waiting for a VM.  
**Website / repo:** [github.com/sadraiiali/termina](https://github.com/sadraiiali/termina) · by [sadraiiali](https://github.com/sadraiiali)  
**Live:** [sadraii.ir/termina](https://sadraii.ir/termina/)  
**Course content:** [AsaEdgerunner/linux-terminal-mastery](https://github.com/AsaEdgerunner/linux-terminal-mastery)
