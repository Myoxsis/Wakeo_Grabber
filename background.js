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

const isWakeoUrl = (url = "") => {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "wakeo.com" || parsed.hostname.endsWith(".wakeo.com");
  } catch (error) {
    return false;
  }
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ capturedLinks: [], recording: false, lockRightSide: false });
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
    if (!isWakeoUrl(currentUrl)) {
      return;
    }

    const lastUrl = TAB_CAPTURE_STATE.get(tabId);
    if (!currentUrl || lastUrl === currentUrl) {
      return;
    }

    TAB_CAPTURE_STATE.set(tabId, currentUrl);
    captureTab(tabId, "auto");
  });
});

const mergeLinks = (existingLinks, incomingLinks) => {
  const seen = new Set(existingLinks.map((item) => item.canonicalUrl || normalizeUrl(item.url)).filter(Boolean));
  const merged = [...existingLinks];

  incomingLinks.forEach((link) => {
    const canonicalUrl = link.canonicalUrl || normalizeUrl(link.url);
    if (!canonicalUrl || !isWakeoUrl(canonicalUrl) || seen.has(canonicalUrl)) {
      return;
    }
    seen.add(canonicalUrl);
    merged.unshift({
      url: link.url,
      canonicalUrl,
      source: link.source || "unknown",
      capturedAt: link.capturedAt || new Date().toISOString()
    });
  });

  return merged;
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "capture-links") {
    chrome.storage.local.get({ capturedLinks: [] }, (data) => {
      const updated = mergeLinks(data.capturedLinks, message.payload.links || []);
      chrome.storage.local.set({ capturedLinks: updated }, () => {
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

  if (message.type === "set-lock-right-side") {
    chrome.storage.local.set({ lockRightSide: message.payload.lockRightSide }, () => {
      sendResponse({ ok: true, lockRightSide: message.payload.lockRightSide });
    });
    return true;
  }

  return false;
});
