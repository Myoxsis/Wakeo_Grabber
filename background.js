const TAB_CAPTURE_STATE = new Map();

const STORAGE_DEFAULTS = {
  capturedLinks: [],
  capturedFetchData: [],
  recording: false,
  lockRightSide: false
};

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
    return parsed.hostname === "app.wakeo.co";
  } catch (error) {
    return false;
  }
};

const isShipmentUrl = (url = "") => {
  const canonicalUrl = normalizeUrl(url);
  if (!canonicalUrl || !isWakeoUrl(canonicalUrl)) {
    return false;
  }

  return canonicalUrl.toLowerCase().includes("shipment");
};

const storageGet = (defaults) =>
  new Promise((resolve) => {
    chrome.storage.local.get(defaults, resolve);
  });

const storageSet = (value) =>
  new Promise((resolve) => {
    chrome.storage.local.set(value, resolve);
  });

const queryAllTabs = () =>
  new Promise((resolve) => {
    chrome.tabs.query({}, resolve);
  });

const sendTabMessage = (tabId, message) =>
  new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, () => {
      resolve(!chrome.runtime.lastError);
    });
  });

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set(STORAGE_DEFAULTS);
});

const captureTab = async (tabId, reason = "auto") => {
  await sendTabMessage(tabId, { type: "capture-request", reason });
};

const captureAllWakeoTabs = async () => {
  const tabs = await queryAllTabs();

  await Promise.all(
    tabs
      .filter((tab) => isWakeoUrl(tab.url || ""))
      .map(async (tab) => {
        if (!tab.id) {
          return;
        }

        TAB_CAPTURE_STATE.set(tab.id, tab.url || "");
        await captureTab(tab.id, "recording-started");
      })
  );
};

const handleRecordingUpdate = async (recording) => {
  if (!recording) {
    TAB_CAPTURE_STATE.clear();
    return;
  }

  await captureAllWakeoTabs();
};

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") {
    return;
  }

  storageGet({ recording: false }).then((data) => {
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
  const seen = new Set(
    existingLinks.map((item) => item.canonicalUrl || normalizeUrl(item.url)).filter(Boolean)
  );
  const merged = [...existingLinks];

  incomingLinks.forEach((link) => {
    const canonicalUrl = link.canonicalUrl || normalizeUrl(link.url);
    if (!canonicalUrl || !isShipmentUrl(canonicalUrl) || seen.has(canonicalUrl)) {
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

const pruneCapturedLinks = (links, fetchItems) => {
  const capturedPageUrls = new Set(fetchItems.map((item) => normalizeUrl(item.pageUrl)).filter(Boolean));
  if (!capturedPageUrls.size) {
    return links;
  }

  return links.filter((link) => {
    const canonicalUrl = link.canonicalUrl || normalizeUrl(link.url);
    return !capturedPageUrls.has(canonicalUrl);
  });
};

const mergeFetchData = (existingItems, incomingItems) => {
  const getKey = (item) => `${item.pageUrl || ""}::${item.requestUrl || ""}`;
  const seen = new Set(existingItems.map(getKey));
  const merged = [...existingItems];

  incomingItems.forEach((item) => {
    const pageUrl = normalizeUrl(item.pageUrl);
    const requestUrl = normalizeUrl(item.requestUrl);

    if (!pageUrl || !requestUrl || !isWakeoUrl(pageUrl) || !isWakeoUrl(requestUrl)) {
      return;
    }

    const key = `${pageUrl}::${requestUrl}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    merged.unshift({
      pageUrl,
      requestUrl,
      source: item.source || "network-json",
      capturedAt: item.capturedAt || new Date().toISOString(),
      data: item.data
    });
  });

  return merged;
};

const messageHandlers = {
  "capture-links": async (message) => {
    const data = await storageGet({ capturedLinks: [], capturedFetchData: [] });
    const mergedLinks = mergeLinks(data.capturedLinks, message.payload.links || []);
    const updated = pruneCapturedLinks(mergedLinks, data.capturedFetchData || []);
    await storageSet({ capturedLinks: updated });
    return { ok: true, count: updated.length };
  },
  "capture-fetch-data": async (message) => {
    const data = await storageGet({ capturedFetchData: [], capturedLinks: [] });
    const updatedFetchData = mergeFetchData(data.capturedFetchData, message.payload.fetchData || []);
    const updatedLinks = pruneCapturedLinks(data.capturedLinks || [], updatedFetchData);
    await storageSet({ capturedFetchData: updatedFetchData, capturedLinks: updatedLinks });
    return { ok: true, count: updatedFetchData.length };
  },
  "set-recording": async (message) => {
    const recording = Boolean(message.payload.recording);
    const data = await storageGet({ capturedLinks: [], capturedFetchData: [] });
    const capturedLinks = recording
      ? pruneCapturedLinks(data.capturedLinks || [], data.capturedFetchData || [])
      : data.capturedLinks || [];
    await storageSet({ recording, capturedLinks });
    await handleRecordingUpdate(recording);
    return { ok: true, recording };
  },
  "set-lock-right-side": async (message) => {
    const lockRightSide = Boolean(message.payload.lockRightSide);
    await storageSet({ lockRightSide });
    return { ok: true, lockRightSide };
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = messageHandlers[message.type];
  if (!handler) {
    return false;
  }

  handler(message, sender)
    .then((response) => sendResponse(response))
    .catch(() => sendResponse({ ok: false }));

  return true;
});
