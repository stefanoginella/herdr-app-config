#!/bin/bash
# launch.sh: start the sandbox's window. It runs until the window is closed: start it in the
# background. The app gets a clean environment, with nothing of yours in it.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
APP="$(py -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$DEMO/bin/herdr-app")"
core_env=()
if [ -n "${HC_SOCKET:-}" ]; then core_env+=("HC_SOCKET=$HC_SOCKET"); fi
cd "$HOME" && exec env -i "${core_env[@]}" HOME="$HOME" HC_SESSION="$HC_SESSION" HERDR_APP_HOME="$A" XDG_STATE_HOME="$XDG_STATE_HOME" \
  XDG_CONFIG_HOME="$XDG_CONFIG_HOME" HERDR_APP_NO_SOUND=1 HERDR_TELEMETRY=0 DO_NOT_TRACK=1 PATH="$PATH" \
  LANG=en_US.UTF-8 TERM=xterm-256color SHELL=/bin/zsh USER=robin LOGNAME=robin TMPDIR="$TMPDIR" \
  "$APP" > "$DEMO/app.log" 2>&1
