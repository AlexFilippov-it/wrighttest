#!/usr/bin/env bash
set -euo pipefail

mkdir -p /tmp/.X11-unix

Xvfb :99 -screen 0 1280x800x24 &
sleep 1

fluxbox >/tmp/fluxbox.log 2>&1 &
sleep 1

x11vnc -display :99 -nopw -listen 0.0.0.0 -rfbport "${VNC_PORT:-5900}" -forever -shared &
sleep 1

websockify --web /usr/share/novnc \
  "0.0.0.0:${NOVNC_PORT:-6080}" \
  "localhost:${VNC_PORT:-5900}"
