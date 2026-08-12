#!/usr/bin/env bash
# Download upstream sources for lab command reference.
# Usage: ./download.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
REG="$ROOT/registry.json"
ARCHIVES="$ROOT/_archives"
mkdir -p "$ARCHIVES"

# name|subdir|url|version|license|lab_cmds|notes
PACKAGES=(
  "coreutils|coreutils|https://github.com/coreutils/coreutils/archive/refs/tags/v9.5.zip|v9.5|GPL-3.0|ls,cat,cp,mv,rm,mkdir,echo,printf,touch,head,tail,wc,whoami,uname,date,env,true,false,sleep,basename,dirname,pwd|GNU coreutils"
  "util-linux|util-linux|https://github.com/util-linux/util-linux/archive/refs/tags/v2.40.2.zip|v2.40.2|GPL-2.0|cal,more,kill,dmesg,mount,umount,login|util-linux"
  "procps|procps|https://gitlab.com/api/v4/projects/procps-ng%2Fprocps/repository/archive.zip?sha=v4.0.4|v4.0.4|GPL-2.0|ps,pgrep,pidof,top,free,uptime,kill,pkill|procps-ng (GitLab archive)"
  "iproute2|iproute2|https://github.com/iproute2/iproute2/archive/refs/tags/v6.11.0.zip|v6.11.0|GPL-2.0|ip,ss,tc,bridge|iproute2"
  "iptables|iptables|https://www.netfilter.org/pub/iptables/iptables-1.8.10.tar.xz|1.8.10|GPL-2.0|iptables,ip6tables,xtables|netfilter iptables"
  "iputils|iputils|https://github.com/iputils/iputils/archive/refs/tags/20240905.zip|20240905|GPL-2.0 / BSD|ping,ping6,tracepath,arping|iputils"
  "curl|curl|https://github.com/curl/curl/archive/refs/tags/curl-8_11_0.zip|8.11.0|curl (MIT-like)|curl|libcurl + curl CLI"
  "nano|nano|https://ftp.gnu.org/gnu/nano/nano-8.2.tar.xz|8.2|GPL-3.0|nano|GNU nano"
  "less|less|https://github.com/gwsw/less/archive/refs/tags/v668.zip|v668|GPL-3.0 / custom|less|less pager"
  "grep|grep|https://ftp.gnu.org/gnu/grep/grep-3.11.tar.xz|3.11|GPL-3.0|grep,egrep,fgrep|GNU grep"
  "bash|bash|https://ftp.gnu.org/gnu/bash/bash-5.2.37.tar.gz|5.2.37|GPL-3.0|bash,sh|GNU Bash"
  "systemd|systemd|https://github.com/systemd/systemd/archive/refs/tags/v256.7.zip|v256.7|LGPL-2.1 / GPL-2.0|systemctl,journalctl,systemd|systemd (large)"
  "cronie|cronie|https://github.com/cronie-crond/cronie/archive/refs/tags/cronie-1.7.2.zip|1.7.2|MIT / GPL|crontab,cron,crond|cronie (Vixie-style)"
  "tree|tree|https://github.com/Old-Man-Programmer/tree/archive/refs/tags/2.1.3.zip|2.1.3|GPL-2.0|tree|tree CLI"
  "vim|vim|https://github.com/vim/vim/archive/refs/tags/v9.1.0.zip|v9.1.0|Vim license|vim,vi|Vim (large)"
)

download_one() {
  local name="$1" subdir="$2" url="$3" version="$4" license="$5" cmds="$6" notes="$7"
  local ext archive dest
  # strip query string for extension
  local urlpath="${url%%\?*}"
  case "$urlpath" in
    *.tar.xz) ext=tar.xz ;;
    *.tar.gz|*.tgz) ext=tar.gz ;;
    *.zip) ext=zip ;;
    *archive.zip*) ext=zip ;;
    *)
      # gitlab API archives are zip
      if [[ "$url" == *"/archive.zip"* ]] || [[ "$url" == *"archive.zip?"* ]]; then ext=zip
      else ext=bin
      fi
      ;;
  esac
  archive="$ARCHIVES/${name}-${version}.${ext}"
  dest="$ROOT/$subdir"

  echo ""
  echo "=== $name ($version) ==="
  echo "    $url"

  if [[ ! -f "$archive" ]]; then
    echo "    downloading..."
    if ! curl -fsSL --retry 3 --connect-timeout 30 -L "$url" -o "$archive.partial"; then
      echo "    FAILED download: $name"
      rm -f "$archive.partial"
      return 1
    fi
    mv "$archive.partial" "$archive"
  else
    echo "    archive cached: $archive"
  fi

  rm -rf "$dest"
  mkdir -p "$dest"
  echo "    extracting..."
  case "$ext" in
    zip)
      unzip -q -o "$archive" -d "$ARCHIVES/_extract_$name"
      # single top-level dir
      local top
      top=$(find "$ARCHIVES/_extract_$name" -mindepth 1 -maxdepth 1 -type d | head -1)
      if [[ -n "$top" ]]; then
        shopt -s dotglob
        mv "$top"/* "$dest/" 2>/dev/null || true
        shopt -u dotglob
      fi
      rm -rf "$ARCHIVES/_extract_$name"
      ;;
    tar.xz)
      tar -xJf "$archive" -C "$dest" --strip-components=1
      ;;
    tar.gz)
      tar -xzf "$archive" -C "$dest" --strip-components=1
      ;;
  esac

  local size
  size=$(du -sh "$dest" 2>/dev/null | awk '{print $1}')
  local sha
  sha=$(sha256sum "$archive" | awk '{print $1}')

  # Append package record via python for valid JSON
  python3 - "$REG" <<PY
import json, sys, datetime
from pathlib import Path
reg_path = Path(sys.argv[1])
data = json.loads(reg_path.read_text())
entry = {
    "name": "$name",
    "subdir": "$subdir",
    "version": "$version",
    "url": "$url",
    "license": "$license",
    "labCommands": [c.strip() for c in "$cmds".split(",") if c.strip()],
    "notes": "$notes",
    "archive": "_archives/${name}-${version}.${ext}",
    "archiveSha256": "$sha",
    "extractedSize": "$size",
    "downloadedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "status": "ok",
}
# replace if exists
data["packages"] = [p for p in data.get("packages", []) if p.get("name") != entry["name"]]
data["packages"].append(entry)
data["packages"].sort(key=lambda p: p["name"])
data["updated"] = entry["downloadedAt"]
reg_path.write_text(json.dumps(data, indent=2) + "\n")
print("    recorded in registry.json (", "$size", ")")
PY
}

FAIL=0
for row in "${PACKAGES[@]}"; do
  IFS='|' read -r name subdir url version license cmds notes <<<"$row"
  if ! download_one "$name" "$subdir" "$url" "$version" "$license" "$cmds" "$notes"; then
    FAIL=$((FAIL + 1))
    python3 - "$REG" <<PY
import json, sys, datetime
from pathlib import Path
reg_path = Path(sys.argv[1])
data = json.loads(reg_path.read_text())
entry = {
    "name": "$name",
    "subdir": "$subdir",
    "version": "$version",
    "url": "$url",
    "license": "$license",
    "labCommands": [c.strip() for c in """$cmds""".split(",") if c.strip()],
    "notes": "$notes",
    "status": "failed",
    "downloadedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}
data["packages"] = [p for p in data.get("packages", []) if p.get("name") != entry["name"]]
data["packages"].append(entry)
data["packages"].sort(key=lambda p: p["name"])
data["updated"] = entry["downloadedAt"]
reg_path.write_text(json.dumps(data, indent=2) + "\n")
PY
  fi
done

echo ""
echo "Done. Failures: $FAIL"
echo "Registry: $REG"
du -sh "$ROOT"/* 2>/dev/null | sort -h | tail -20
