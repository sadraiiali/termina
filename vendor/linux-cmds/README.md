# Linux command upstream sources (reference)

This folder holds **real upstream source trees** for the classic Linux tools that
the FakeShell lab reimplements (or fakes) in TypeScript.

## Important

| Fact | Detail |
|------|--------|
| **Not compiled into the browser** | Sources are **reference** for CLI/behavior when implementing lab cmds |
| **Runtime** | Lab still runs `src/lib/fakeshell` (TS) against almostnode VFS |
| **Tracking** | See **`registry.json`** for URL, version, SHA256, license, lab cmds |

## Layout

```
vendor/linux-cmds/
  registry.json     # machine-readable download manifest
  download.sh       # re-fetch / refresh all packages
  README.md
  _archives/        # raw zip/tar downloads
  coreutils/        # extracted sources
  util-linux/
  procps/
  iproute2/
  iptables/
  iputils/
  curl/
  nano/
  less/
  grep/
  bash/
  systemd/
  cronie/
  tree/
  vim/
```

## Re-download / update

```bash
cd vendor/linux-cmds
./download.sh
```

Archives are cached under `_archives/` so re-runs only re-extract when needed.

## Packages (see registry.json for full detail)

| Package | Lab commands (examples) |
|---------|-------------------------|
| coreutils | ls cat cp mv rm mkdir echo printf touch head tail wc … |
| util-linux | cal more kill … |
| procps | ps pgrep pidof top free uptime … |
| iproute2 | ip |
| iptables | iptables ip6tables |
| iputils | ping |
| curl | curl |
| nano | nano |
| less | less |
| grep | grep |
| bash | bash sh |
| systemd | systemctl journalctl |
| cronie | crontab cron |
| tree | tree |
| vim | vim vi |

## Git

Large extracted trees and archives are **gitignored** by default (see repo
`.gitignore`). Keep `registry.json` + `download.sh` + this README in git so
anyone can restore sources with `./download.sh`.
