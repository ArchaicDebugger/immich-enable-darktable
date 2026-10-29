const NATIVE_HOST = 'com.immich.darktable';
const SCRIPT_ID = 'immich-darktable';

const DEFAULTS = {
  immichUrl: '',
  apiKey: '',
  downloadDir: '~/Pictures/Immich-darktable',
  darktableCommand: 'auto',
  pathMappings: [],
  insecureTls: false,
};

async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
}

// The content script is registered dynamically for the configured Immich origin only.
async function registerContentScript(origin) {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  if (!origin) return;
  await chrome.scripting.registerContentScripts([
    { id: SCRIPT_ID, matches: [`${origin}/*`], js: ['content.js'], runAt: 'document_idle' },
  ]);
}

async function getAuth(origin, settings) {
  if (settings.apiKey) return { apiKey: settings.apiKey };
  const cookie = await chrome.cookies.get({ url: origin, name: 'immich_access_token' });
  if (!cookie) throw new Error('Not logged in to Immich (no session cookie). Log in, or set an API key in the options.');
  return { token: cookie.value };
}

async function openInDarktable(assetIds, tab) {
  try {
    const settings = await getSettings();
    const origin = new URL(tab.url).origin;
    const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST, {
      action: 'open',
      server: origin,
      assetIds,
      auth: await getAuth(origin, settings),
      downloadDir: settings.downloadDir,
      darktableCommand: settings.darktableCommand,
      pathMappings: settings.pathMappings,
      insecureTls: settings.insecureTls,
    });
    return response ?? { ok: false, error: 'Empty response from native host' };
  } catch (e) {
    let error = e.message || String(e);
    if (/native messaging host not found|Specified native messaging host/i.test(error)) {
      error += ' Run native-host/install.sh and restart the browser.';
    }
    return { ok: false, error };
  }
}

async function triggerOnTab(tab) {
  const { immichUrl } = await getSettings();
  if (!immichUrl || !tab?.url?.startsWith(immichUrl)) {
    chrome.runtime.openOptionsPage();
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'trigger' }).catch(() => {
    // Content script not injected yet (tab opened before setup): inject and retry.
    chrome.scripting
      .executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
      .then(() => chrome.tabs.sendMessage(tab.id, { type: 'trigger' }));
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'open' && sender.tab) {
    openInDarktable(msg.assetIds, sender.tab).then(sendResponse);
    return true;
  }
  if (msg.type === 'register') {
    registerContentScript(msg.origin)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});

chrome.action.onClicked.addListener(triggerOnTab);

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'open-in-darktable') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) triggerOnTab(tab);
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const { immichUrl } = await getSettings();
  if (immichUrl) await registerContentScript(immichUrl);
  else if (reason === 'install') chrome.runtime.openOptionsPage();
});
