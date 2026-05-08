#!/usr/bin/env bash
set -euo pipefail

DISPLAY_NUM="${DISPLAY:-:99}"
DISPLAY_ID="${DISPLAY_NUM#:}"
VNC_PORT="${VNC_PORT:-5900}"
NOVNC_PORT="${NOVNC_PORT:-6080}"
GEOMETRY="${VNC_GEOMETRY:-1280x800}"
DEPTH="${VNC_DEPTH:-24}"

mkdir -p /tmp/.X11-unix /root/.vnc
rm -f "/tmp/.X${DISPLAY_ID}-lock" "/tmp/.X11-unix/X${DISPLAY_ID}"

Xtigervnc "${DISPLAY_NUM}" \
  -geometry "${GEOMETRY}" \
  -depth "${DEPTH}" \
  -rfbport "${VNC_PORT}" \
  -SecurityTypes None \
  -localhost no \
  -AlwaysShared=1 \
  -AcceptSetDesktopSize=0 \
  -desktop "WrightTest noVNC" \
  >/tmp/xtigervnc.log 2>&1 &

sleep 2

export DISPLAY="${DISPLAY_NUM}"
fluxbox >/tmp/fluxbox.log 2>&1 &
sleep 1

websockify --web /usr/share/novnc \
  "0.0.0.0:${NOVNC_PORT}" \
  "localhost:${VNC_PORT}"
