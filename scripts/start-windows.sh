#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
launcher="$(wslpath -w "$project_root/scripts/start-windows.ps1")"

exec powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$launcher" "$@"
