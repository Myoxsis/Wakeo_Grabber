const TAB_CAPTURE_STATE = new Map();

const STORAGE_DEFAULTS = {
  capturedLinks: [],
  capturedFetchData: [],
  recording: false,
  lockRightSide: false
};

const normalizeUrl = (url = "") => {
  if (!url) return null;

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
    return new URL(url).hostname === "app.wakeo.co";
  } catch (error) {
    return false;
  }
};

const isShipmentUrl = (url = "") => {
  const canonicalUrl = normalizeUrl(url);
  return Boolean(canonicalUrl && isWakeoUrl(canonicalUrl) && canonicalUrl.toLowerCase().includes("shipment"));
};

const getWakeoApiEndpointType = (url = "") => {
  const canonicalUrl = normalizeUrl(url);
  if (!canonicalUrl) return null;

  try {
    const parsed = new URL(canonicalUrl);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    if (hostname !== "internal.api.wakeo.co") return null;
    if (/^\/api\/v1\/orders\/[a-f0-9]+\/?$/i.test(pathname)) return "shipment";
    if (/^\/api\/v1\/orders\/[a-f0-9]+\/timeline\/?$/i.test(pathname)) return "timeline";

    return null;
  } catch (error) {
    return null;
  }
};

const storageGet = (defaults) =>
  new Promise((resolve) => chrome.storage.local.get(defaults, resolve));

const storageSet = (value) =>
  new Promise((resolve) => chrome.storage.local.set(value, resolve));

const queryAllTabs = () =>
  new Promise((resolve) => chrome.tabs.query({}, resolve));

const sendTabMessage = (tabId, message) =>
  new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, () => {
      resolve(!chrome.runtime.lastError);
    });
  });

const injectContentScript = (tabId) =>
  new Promise((resolve) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: ["content.js"]
      },
      () => resolve(!chrome.runtime.lastError)
    );
  });

const injectMainWorldHook = (tabId) =>
  new Promise((resolve) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: ["page-hook.js"],
        world: "MAIN"
      },
      () => resolve(!chrome.runtime.lastError)
    );
  });

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set(STORAGE_DEFAULTS);

  try {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    // Ignore side panel behavior setup failures.
  }
});

const captureTab = async (tabId, reason = "auto") => {
  let delivered = await sendTabMessage(tabId, { type: "capture-request", reason });

  if (!delivered) {
    await injectMainWorldHook(tabId);
    await injectContentScript(tabId);
    delivered = await sendTabMessage(tabId, { type: "capture-request", reason });
  }

  return delivered;
};

const captureAllWakeoTabs = async () => {
  const tabs = await queryAllTabs();

  await Promise.all(
    tabs
      .filter((tab) => isWakeoUrl(tab.url || ""))
      .map(async (tab) => {
        if (!tab.id) return;

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
  if (changeInfo.status !== "complete") return;

  const currentUrl = tab?.url || changeInfo.url || "";
  if (!isWakeoUrl(currentUrl)) return;

  storageGet({ recording: false }).then((data) => {
    if (!data.recording) return;

    const lastUrl = TAB_CAPTURE_STATE.get(tabId);
    if (!currentUrl || lastUrl === currentUrl) return;

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

const getDataWeight = (value) => {
  if (value === null || value === undefined) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object") return Object.keys(value).length;
  return 1;
};

const shouldReplaceCapturedPayload = (existingItem, incomingItem) => {
  const existingWeight = getDataWeight(existingItem?.data);
  const incomingWeight = getDataWeight(incomingItem?.data);

  if (incomingWeight !== existingWeight) {
    return incomingWeight > existingWeight;
  }

  const existingCapturedAt = Date.parse(existingItem?.capturedAt || 0);
  const incomingCapturedAt = Date.parse(incomingItem?.capturedAt || 0);

  return incomingCapturedAt > existingCapturedAt;
};

const pickTimelinePayload = (item) => {
  if (item.historicalData !== undefined) return item.historicalData;
  if (item.timeline !== undefined) return item.timeline;
  return item.data;
};

const mergeEndpointTypes = (...items) =>
  [...new Set(items.flatMap((item) => item?.endpointTypes || []).filter(Boolean))];

const getLatestCapturedAt = (item) => {
  const timestamps = [item.capturedAt, item.dataCapturedAt, item.historicalDataCapturedAt]
    .map((value) => Date.parse(value || 0))
    .filter((value) => !Number.isNaN(value));

  if (!timestamps.length) return new Date().toISOString();

  return new Date(Math.max(...timestamps)).toISOString();
};

const toNormalizedFetchItem = (item) => {
  const pageUrl = normalizeUrl(item.pageUrl);

  if (!pageUrl || !isWakeoUrl(pageUrl)) {
    return null;
  }

  const normalizedItem = {
    pageUrl,
    source: item.source || "network-json",
    capturedAt: item.capturedAt || new Date().toISOString(),
    endpointTypes: mergeEndpointTypes(item)
  };

  const shipmentRequestUrl = normalizeUrl(item.dataRequestUrl || item.requestUrl);
  const shipmentEndpointType = getWakeoApiEndpointType(shipmentRequestUrl);

  if (shipmentEndpointType === "shipment" && item.data !== undefined) {
    normalizedItem.data = item.data;
    normalizedItem.dataCapturedAt = item.dataCapturedAt || item.capturedAt || new Date().toISOString();
    normalizedItem.dataRequestUrl = shipmentRequestUrl;

    if (!normalizedItem.endpointTypes.includes("shipment")) {
      normalizedItem.endpointTypes.push("shipment");
    }
  }

  const timelineRequestUrl = normalizeUrl(item.historicalDataRequestUrl || item.requestUrl);
  const timelineEndpointType = getWakeoApiEndpointType(timelineRequestUrl);
  const timelinePayload = pickTimelinePayload(item);

  if (timelineEndpointType === "timeline" && timelinePayload !== undefined) {
    normalizedItem.historicalData = timelinePayload;
    normalizedItem.historicalDataCapturedAt =
      item.historicalDataCapturedAt || item.capturedAt || new Date().toISOString();
    normalizedItem.historicalDataRequestUrl = timelineRequestUrl;

    if (!normalizedItem.endpointTypes.includes("timeline")) {
      normalizedItem.endpointTypes.push("timeline");
    }
  }

  if (!normalizedItem.endpointTypes.length) {
    return null;
  }

  normalizedItem.capturedAt = getLatestCapturedAt(normalizedItem);

  return normalizedItem;
};

const mergeFetchItem = (existingItem, incomingItem) => {
  const mergedItem = {
    ...existingItem,
    pageUrl: incomingItem.pageUrl || existingItem.pageUrl,
    source: incomingItem.source || existingItem.source || "network-json",
    endpointTypes: mergeEndpointTypes(existingItem, incomingItem)
  };

  if (incomingItem.data !== undefined) {
    const shouldReplaceData = shouldReplaceCapturedPayload(
      {
        data: existingItem.data,
        capturedAt: existingItem.dataCapturedAt || existingItem.capturedAt
      },
      {
        data: incomingItem.data,
        capturedAt: incomingItem.dataCapturedAt || incomingItem.capturedAt
      }
    );

    if (shouldReplaceData) {
      mergedItem.data = incomingItem.data;
      mergedItem.dataCapturedAt = incomingItem.dataCapturedAt || incomingItem.capturedAt;
      mergedItem.dataRequestUrl = incomingItem.dataRequestUrl;
    }
  }

  if (incomingItem.historicalData !== undefined) {
    const shouldReplaceHistoricalData = shouldReplaceCapturedPayload(
      {
        data: existingItem.historicalData,
        capturedAt: existingItem.historicalDataCapturedAt || existingItem.capturedAt
      },
      {
        data: incomingItem.historicalData,
        capturedAt: incomingItem.historicalDataCapturedAt || incomingItem.capturedAt
      }
    );

    if (shouldReplaceHistoricalData) {
      mergedItem.historicalData = incomingItem.historicalData;
      mergedItem.historicalDataCapturedAt =
        incomingItem.historicalDataCapturedAt || incomingItem.capturedAt;
      mergedItem.historicalDataRequestUrl = incomingItem.historicalDataRequestUrl;
    }
  }

  mergedItem.capturedAt = getLatestCapturedAt(mergedItem);

  return mergedItem;
};

const mergeFetchData = (existingItems, incomingItems) => {
  const merged = [];
  const indexByKey = new Map();

  const addOrMergeItem = (item, prepend = false) => {
    const normalizedItem = toNormalizedFetchItem(item);

    if (!normalizedItem) {
      return;
    }

    const key = normalizedItem.pageUrl;
    const existingIndex = indexByKey.get(key);

    if (existingIndex === undefined) {
      if (prepend) {
        merged.unshift(normalizedItem);

        indexByKey.clear();
        merged.forEach((entry, index) => {
          indexByKey.set(entry.pageUrl, index);
        });
      } else {
        merged.push(normalizedItem);
        indexByKey.set(key, merged.length - 1);
      }

      return;
    }

    merged[existingIndex] = mergeFetchItem(merged[existingIndex], normalizedItem);
  };

  existingItems.forEach((item) => addOrMergeItem(item, false));
  incomingItems.forEach((item) => addOrMergeItem(item, true));

  return merged;
};

const messageHandlers = {
  "capture-links": async (message) => {
    const data = await storageGet({ capturedLinks: [], capturedFetchData: [] });
    const mergedLinks = mergeLinks(data.capturedLinks, message.payload.links || []);
    const updated = pruneCapturedLinks(mergedLinks, data.capturedFetchData || []);

    await storageSet({ capturedLinks: updated });

    return {
      ok: true,
      count: updated.length
    };
  },

  "capture-fetch-data": async (message) => {
    const data = await storageGet({ capturedFetchData: [], capturedLinks: [] });

    const updatedFetchData = mergeFetchData(
      data.capturedFetchData,
      message.payload.fetchData || []
    );

    const updatedLinks = pruneCapturedLinks(
      data.capturedLinks || [],
      updatedFetchData
    );

    await storageSet({
      capturedFetchData: updatedFetchData,
      capturedLinks: updatedLinks
    });

    return {
      ok: true,
      count: updatedFetchData.length
    };
  },

  "set-recording": async (message) => {
    const recording = Boolean(message.payload.recording);
    const data = await storageGet({
      capturedLinks: [],
      capturedFetchData: []
    });

    const capturedLinks = recording
      ? pruneCapturedLinks(data.capturedLinks || [], data.capturedFetchData || [])
      : data.capturedLinks || [];

    await storageSet({ recording, capturedLinks });

    await handleRecordingUpdate(recording);

    return {
      ok: true,
      recording
    };
  },

  "set-lock-right-side": async (message) => {
    const lockRightSide = Boolean(message.payload.lockRightSide);

    await storageSet({ lockRightSide });

    return {
      ok: true,
      lockRightSide
    };
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = messageHandlers[message?.type];

  if (!handler) {
    return false;
  }

  handler(message, sender)
    .then((response) => sendResponse(response))
    .catch(() => sendResponse({ ok: false }));

  return true;
});
