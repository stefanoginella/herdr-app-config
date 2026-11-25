#!/bin/sh
# run.sh <app> <state[:more]> <title> <text file> [later state]: a stand-in for an agent, for a picture.
# It prints a screen, reports a status as an agent does (OSC 7501), and waits.
printf '\033]0;%s\007' "$3"
printf '\033[2J\033[H'
printf '%b' "$(cat "$4")"
printf '\033]7501;state=%s:app=%s\033\\' "$2" "$1"
if [ -n "$5" ]; then sleep 4; printf '\033]7501;state=%s:app=%s\033\\' "$5" "$1"; fi
exec sleep 100000
