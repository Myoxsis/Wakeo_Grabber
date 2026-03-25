const TAB_CAPTURE_STATE = new Map();
const normalizeUrl = (url = "") => {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch (error) {
    return url;
  }
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ capturedProfiles: [], recording: false });
});

const captureTab = (tabId, reason = "auto") => {
  chrome.tabs.sendMessage(tabId, { type: "capture-request", reason }, () => {
    const lastError = chrome.runtime.lastError;
    if (lastError) {
      return;
    }
  });
};

const handleRecordingUpdate = (recording) => {
  if (!recording) {
    TAB_CAPTURE_STATE.clear();
  }
};

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") {
    return;
  }

  chrome.storage.local.get({ recording: false }, (data) => {
    if (!data.recording) {
      return;
    }

    const currentUrl = tab?.url || changeInfo.url || "";
    const lastUrl = TAB_CAPTURE_STATE.get(tabId);
    if (!currentUrl || lastUrl === currentUrl) {
      return;
    }

    TAB_CAPTURE_STATE.set(tabId, currentUrl);
    captureTab(tabId, "auto");
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "capture-profile") {
    chrome.storage.local.get({ capturedProfiles: [] }, (data) => {
      const urlKey = message.payload.canonicalUrl || normalizeUrl(message.payload.url);
      const existing = urlKey
        ? data.capturedProfiles.some((profile) => {
            const existingKey = profile.canonicalUrl || normalizeUrl(profile.url);
            return existingKey === urlKey;
          })
        : false;
      if (existing) {
        sendResponse({ ok: true, count: data.capturedProfiles.length, skipped: true });
        return;
      }
      const updated = [message.payload, ...data.capturedProfiles];
      chrome.storage.local.set({ capturedProfiles: updated }, () => {
        sendResponse({ ok: true, count: updated.length });
      });
    });
    return true;
  }
  if (message.type === "set-recording") {
    chrome.storage.local.set({ recording: message.payload.recording }, () => {
      handleRecordingUpdate(message.payload.recording);
      sendResponse({ ok: true, recording: message.payload.recording });
    });
    return true;
  }
  return false;
});
