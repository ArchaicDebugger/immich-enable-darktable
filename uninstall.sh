#!/usr/bin/env bash
set -euo pipefail
HOST_NAME="com.immich.darktable"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

rm -fv "$HOME"/.config/{google-chrome,google-chrome-beta,google-chrome-unstable,chromium}/NativeMessagingHosts/$HOST_NAME.json \
  "$HOME"/.config/BraveSoftware/Brave-Browser{,-Beta,-Nightly}/NativeMessagingHosts/$HOST_NAME.json \
  "$HERE/run-host.sh"

for app in com.brave.Browser com.google.Chrome org.chromium.Chromium; do
  [ -d "$HOME/.var/app/$app" ] || continue
  find "$HOME/.var/app/$app/config" -path "*NativeMessagingHosts/$HOST_NAME.json" -print -delete 2>/dev/null || true
  rm -rfv "$HOME/.var/app/$app/data/immich-darktable"
  command -v flatpak >/dev/null && flatpak override --user --no-talk-name=org.freedesktop.Flatpak "$app" 2>/dev/null || true
done
