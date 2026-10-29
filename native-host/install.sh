#!/usr/bin/env bash
# Registers the native messaging host for Chrome, Chromium and Brave (native and Flatpak).
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this as your normal user, not with sudo: it installs into your home directory." >&2
  exit 1
fi

HOST_NAME="com.immich.darktable"
EXTENSION_ID="blhmkodjebnojckkigmbjgjgcocdejhi"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_PY="$HERE/immich_darktable_host.py"
PYTHON="$(command -v /usr/bin/python3 || command -v python3)"

chmod +x "$HOST_PY"

write_manifest() { # $1 = manifest dir, $2 = executable path
  mkdir -p "$1"
  cat > "$1/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Open Immich photos in darktable",
  "path": "$2",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF
  echo "  installed $1/$HOST_NAME.json"
}

# Native (non-sandboxed) browsers: run the script directly.
WRAPPER="$HERE/run-host.sh"
cat > "$WRAPPER" <<EOF
#!/bin/sh
exec "$PYTHON" "$HOST_PY" "\$@"
EOF
chmod +x "$WRAPPER"

for dir in \
  "$HOME/.config/google-chrome" \
  "$HOME/.config/google-chrome-beta" \
  "$HOME/.config/google-chrome-unstable" \
  "$HOME/.config/chromium" \
  "$HOME/.config/BraveSoftware/Brave-Browser" \
  "$HOME/.config/BraveSoftware/Brave-Browser-Beta" \
  "$HOME/.config/BraveSoftware/Brave-Browser-Nightly"; do
  if [ -d "$dir" ]; then write_manifest "$dir/NativeMessagingHosts" "$WRAPPER"; fi
done

# Flatpak browsers can't see this folder or run host programs, so put a small wrapper
# inside the app's own data dir that escapes the sandbox with flatpak-spawn --host.
for app in com.brave.Browser com.google.Chrome org.chromium.Chromium; do
  command -v flatpak >/dev/null && flatpak info "$app" >/dev/null 2>&1 || continue
  case "$app" in
    com.brave.Browser) cfg="$HOME/.var/app/$app/config/BraveSoftware/Brave-Browser" ;;
    com.google.Chrome) cfg="$HOME/.var/app/$app/config/google-chrome" ;;
    org.chromium.Chromium) cfg="$HOME/.var/app/$app/config/chromium" ;;
  esac
  fp_wrapper="$HOME/.var/app/$app/data/immich-darktable/run-host.sh"
  mkdir -p "$(dirname "$fp_wrapper")"
  cat > "$fp_wrapper" <<EOF
#!/bin/sh
exec flatpak-spawn --host "$PYTHON" "$HOST_PY" "\$@"
EOF
  chmod +x "$fp_wrapper"
  write_manifest "$cfg/NativeMessagingHosts" "$fp_wrapper"
  # The sandbox can't read this repo either, so give it a copy of the extension to load.
  ext_copy="$HOME/.var/app/$app/data/immich-darktable/extension"
  rm -rf "$ext_copy" && cp -r "$HERE/../extension" "$ext_copy"
  echo "  extension copied for $app: load unpacked from $ext_copy"
  echo "  allowing $app to run host commands (flatpak override --talk-name=org.freedesktop.Flatpak)"
  flatpak override --user --talk-name=org.freedesktop.Flatpak "$app"
done

echo "Done. Restart the browser, then load the 'extension' folder as an unpacked extension."
