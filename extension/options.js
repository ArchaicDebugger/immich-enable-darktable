const $ = (id) => document.getElementById(id);
const status = $('status');

function parseMappings(text) {
  return text
    .split('\n')
    .map((line) => line.split('=>').map((s) => s.trim()))
    .filter((parts) => parts.length === 2 && parts[0] && parts[1])
    .map(([from, to]) => ({ from, to }));
}

async function load() {
  const s = await chrome.storage.local.get(null);
  $('immichUrl').value = s.immichUrl || '';
  $('apiKey').value = s.apiKey || '';
  $('downloadDir').value = s.downloadDir || '~/Pictures/Immich-darktable';
  $('darktableCommand').value = s.darktableCommand || 'auto';
  $('pathMappings').value = (s.pathMappings || []).map((m) => `${m.from} => ${m.to}`).join('\n');
  $('insecureTls').checked = !!s.insecureTls;
}

function setStatus(text, isError) {
  status.textContent = text;
  status.className = isError ? 'err' : '';
}

$('save').addEventListener('click', async () => {
  let origin = '';
  const raw = $('immichUrl').value.trim();
  if (raw) {
    try {
      origin = new URL(raw).origin;
    } catch {
      return setStatus('Invalid Immich URL', true);
    }
    // Must be called directly from the click handler to count as a user gesture.
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) return setStatus('Access to the Immich site was not granted', true);
  }

  await chrome.storage.local.set({
    immichUrl: origin,
    apiKey: $('apiKey').value.trim(),
    downloadDir: $('downloadDir').value.trim() || '~/Pictures/Immich-darktable',
    darktableCommand: $('darktableCommand').value.trim() || 'auto',
    pathMappings: parseMappings($('pathMappings').value),
    insecureTls: $('insecureTls').checked,
  });
  $('immichUrl').value = origin;

  const res = await chrome.runtime.sendMessage({ type: 'register', origin });
  if (!res?.ok) return setStatus(`Saved, but could not register: ${res?.error}`, true);
  setStatus('Saved. Reload any open Immich tabs.');
});

load();
