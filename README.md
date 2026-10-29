# Immich → darktable

A Chrome/Brave extension that adds an **Open in darktable** button to Immich. Select one or more photos (or open one in the viewer), click the button, and darktable opens them on this machine.

## How it works

- **Extension** (`extension/`): on your Immich site it watches for selected thumbnails (`[data-asset][data-selected]`) or the asset open in the viewer (`/photos/<id>`) and shows a floating button. The toolbar icon and **Alt+Shift+D** do the same thing.
- **Native host** (`native-host/immich_darktable_host.py`): a browser extension can't start programs on your computer, so a small Python script (standard library only) does it. It asks Immich for each asset, downloads the original to the download folder (or uses the local file if a path mapping matches), then runs darktable with all the files. If darktable is already open, it passes the images to that window over D-Bus.
- Auth: uses your logged-in Immich session cookie, or an API key if you set one.
- Downloaded copies are named `<name>__<id8>.<ext>` and reused next time, so your darktable edits (XMP sidecars) are kept.

## Setup

1. `./native-host/install.sh`
   - Registers the host for Chrome, Chromium and Brave (native and Flatpak).
   - For **Flatpak** browsers it puts a small wrapper script inside the app's data folder that runs the host outside the sandbox with `flatpak-spawn --host`. It also runs `flatpak override --user --talk-name=org.freedesktop.Flatpak <app>`. **That override lets the browser run commands outside its sandbox**, so it weakens the sandbox. `uninstall.sh` takes the permission away again.
2. Restart the browser.
3. Open `brave://extensions` (or `chrome://extensions`), turn on Developer mode, click **Load unpacked**, and choose the `extension/` folder. The extension ID is fixed: `blhmkodjebnojckkigmbjgjgcocdejhi`.
4. On the options page that opens, enter your Immich URL, save, and allow access. Then reload your Immich tabs.

## Notes

- Videos are skipped.
- Immich only keeps the thumbnails near your scroll position on the page. If you select photos and then scroll far away, the extension can't see the ones that are off screen. Open them while they're still on screen.
- Path mappings: if Immich's storage is mounted on this machine, map the server path to the local path, for example `/usr/src/app/upload => /srv/immich/upload`. darktable then edits the originals in place instead of downloaded copies.
- Logs: `~/.cache/immich-darktable/host.log` and `darktable.log`.
