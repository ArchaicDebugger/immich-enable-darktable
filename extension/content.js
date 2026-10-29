(() => {
  if (window.__immichDarktable) return;
  window.__immichDarktable = true;

  const UUID = /\/photos\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

  // Asset open in the full-screen viewer wins; otherwise use the timeline/album selection.
  // Note: Immich virtualises the timeline, so selected thumbnails scrolled far out of view
  // are not in the DOM and won't be picked up.
  function currentAssetIds() {
    const viewed = location.pathname.match(UUID);
    if (viewed) return [viewed[1]];
    const ids = [...document.querySelectorAll('[data-asset][data-selected]')].map((el) => el.dataset.asset);
    return [...new Set(ids)];
  }

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .wrap { display:flex; flex-direction:column; align-items:flex-end; gap:8px; font:500 14px system-ui,sans-serif; }
      button { display:flex; align-items:center; gap:8px; border:0; border-radius:999px; padding:10px 16px;
        background:#1f2937; color:#fff; cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,.35); font:inherit; }
      button:hover { background:#374151; }
      button:disabled { opacity:.7; cursor:progress; }
      .dot { width:10px; height:10px; border-radius:50%; background:#a3e635; }
      .toast { max-width:360px; padding:10px 14px; border-radius:10px; background:#111827; color:#f9fafb;
        box-shadow:0 4px 14px rgba(0,0,0,.35); white-space:pre-wrap; }
      .toast.error { background:#7f1d1d; }
      [hidden] { display:none !important; }
    </style>
    <div class="wrap">
      <div class="toast" hidden></div>
      <button type="button" hidden><span class="dot"></span><span class="label"></span></button>
    </div>`;
  const button = root.querySelector('button');
  const label = root.querySelector('.label');
  const toast = root.querySelector('.toast');
  let busy = false;
  let toastTimer;

  function showToast(text, isError) {
    toast.textContent = text;
    toast.classList.toggle('error', !!isError);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), isError ? 12000 : 5000);
  }

  function refresh() {
    if (busy) return;
    const n = currentAssetIds().length;
    button.hidden = n === 0;
    label.textContent = n === 1 ? 'Open in darktable' : `Open ${n} in darktable`;
  }

  async function open() {
    const assetIds = currentAssetIds();
    if (busy) return;
    if (!assetIds.length) {
      showToast('Select one or more photos first.', true);
      return;
    }
    busy = true;
    button.disabled = true;
    label.textContent = `Preparing ${assetIds.length} file${assetIds.length > 1 ? 's' : ''}…`;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'open', assetIds });
      if (!res?.ok) {
        showToast(`darktable: ${res?.error || 'unknown error'}`, true);
      } else {
        const lines = [`Opened ${res.opened.length} file${res.opened.length === 1 ? '' : 's'} in darktable.`];
        for (const s of res.skipped || []) lines.push(`Skipped ${s.id.slice(0, 8)}: ${s.reason}`);
        showToast(lines.join('\n'), (res.skipped || []).length > 0);
      }
    } catch (e) {
      showToast(`darktable: ${e.message}`, true);
    } finally {
      busy = false;
      button.disabled = false;
      refresh();
    }
  }

  button.addEventListener('click', open);
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'trigger') open();
  });

  document.documentElement.appendChild(host);
  refresh();
  setInterval(refresh, 400);
})();
