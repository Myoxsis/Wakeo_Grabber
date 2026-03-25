const normalizeUrl = (url = "") => {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url, window.location.origin);
    parsed.hash = "";
    return parsed.toString();
  } catch (error) {
    return null;
  }
};

const PAGE_HOOK_EVENT = "wakeo-grabber-network-capture";

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

const toLinkEntry = (url, source) => {
  const canonicalUrl = normalizeUrl(url);
  if (!canonicalUrl || !isShipmentUrl(canonicalUrl)) {
    return null;
  }

  return {
    url: canonicalUrl,
    canonicalUrl,
    source,
    capturedAt: new Date().toISOString()
  };
};

const safeRuntimeSendMessage = (message, callback) => {
  if (!chrome?.runtime?.id) {
    callback?.({ ok: false, reason: "extension-context-invalidated" });
    return;
  }

  try {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        callback?.({ ok: false, reason: chrome.runtime.lastError.message });
        return;
      }

      callback?.(response);
    });
  } catch (error) {
    callback?.({ ok: false, reason: "runtime-send-failed" });
  }
};

const collectWakeoLinks = () => {
  const linkMap = new Map();

  const addEntry = (url, source) => {
    const entry = toLinkEntry(url, source);
    if (!entry) {
      return;
    }

    linkMap.set(entry.canonicalUrl, entry);
  };

  addEntry(window.location.href, "page");

  document.querySelectorAll("a[href]").forEach((anchor) => {
    addEntry(anchor.href, "dom-link");
  });

  performance
    .getEntriesByType("resource")
    .filter((entry) => entry?.name)
    .forEach((entry) => {
      addEntry(entry.name, "network-resource");
    });

  return [...linkMap.values()];
};

const pushCapturedLinks = () => {
  if (!isWakeoUrl(window.location.href)) {
    return;
  }

  const links = collectWakeoLinks();
  safeRuntimeSendMessage({ type: "capture-links", payload: { links } });
};

let recordIntervalId = null;

const stopContinuousCapture = () => {
  if (!recordIntervalId) {
    return;
  }

  clearInterval(recordIntervalId);
  recordIntervalId = null;
};

const startContinuousCapture = () => {
  stopContinuousCapture();
  pushCapturedLinks();
  recordIntervalId = setInterval(() => {
    pushCapturedLinks();
  }, 3000);
};

const setContinuousCapture = (recording) => {
  if (recording) {
    startContinuousCapture();
    return;
  }

  stopContinuousCapture();
};

const collectShipmentFetchData = async () => {
  if (!isShipmentUrl(window.location.href)) {
    return [];
  }

  const seenRequestUrls = new Set();
  const candidates = performance
    .getEntriesByType("resource")
    .filter((entry) => entry?.name && ["fetch", "xmlhttprequest"].includes(entry.initiatorType))
    .map((entry) => entry.name)
    .filter((url) => {
      const normalized = normalizeUrl(url);
      return normalized && isWakeoUrl(normalized) && normalized.includes("/shipment");
    })
    .filter((url) => {
      const canonical = normalizeUrl(url);
      if (!canonical || seenRequestUrls.has(canonical)) {
        return false;
      }
      seenRequestUrls.add(canonical);
      return true;
    });

  const capturedAt = new Date().toISOString();
  const fetchData = await Promise.all(
    candidates.map(async (requestUrl) => {
      try {
        const response = await fetch(requestUrl, {
          method: "GET",
          credentials: "include",
          headers: {
            Accept: "application/json"
          }
        });

        if (!response.ok) {
          return null;
        }

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.toLowerCase().includes("application/json")) {
          return null;
        }

        const data = await response.json();
        return {
          pageUrl: normalizeUrl(window.location.href),
          requestUrl: normalizeUrl(requestUrl),
          source: "network-json",
          capturedAt,
          data
        };
      } catch (error) {
        return null;
      }
    })
  );

  return fetchData.filter(Boolean);
};

const isShipmentApiUrl = (url = "") => {
  const canonicalUrl = normalizeUrl(url);
  if (!canonicalUrl || !isWakeoUrl(canonicalUrl)) {
    return false;
  }

  const lowerUrl = canonicalUrl.toLowerCase();
  return lowerUrl.includes("/shipment") || lowerUrl.includes("/shipments");
};

const toPageHookFetchEntry = (payload) => {
  const requestUrl = normalizeUrl(payload?.requestUrl);
  if (!requestUrl || !isShipmentApiUrl(requestUrl)) {
    return null;
  }

  const pageUrl = normalizeUrl(window.location.href);
  if (!pageUrl || !isShipmentUrl(pageUrl)) {
    return null;
  }

  return {
    pageUrl,
    requestUrl,
    source: payload?.source || "page-network-hook",
    capturedAt: payload?.capturedAt || new Date().toISOString(),
    data: payload?.data
  };
};

const flushPageHookQueue = async () => {
  const queuedItems = flushPageHookQueue.queue;
  if (!queuedItems.length || flushPageHookQueue.inFlight) {
    return;
  }

  flushPageHookQueue.inFlight = true;
  const payload = queuedItems.splice(0, queuedItems.length);

  safeRuntimeSendMessage({ type: "capture-fetch-data", payload: { fetchData: payload } }, () => {
    flushPageHookQueue.inFlight = false;
    if (flushPageHookQueue.queue.length) {
      flushPageHookQueue();
    }
  });
};
flushPageHookQueue.queue = [];
flushPageHookQueue.inFlight = false;

const enqueuePageHookCapture = (entry) => {
  if (!entry) {
    return;
  }

  flushPageHookQueue.queue.push(entry);
  flushPageHookQueue();
};

const handlePageHookEvent = (event) => {
  const detail = event.detail;
  if (!detail || detail.type !== PAGE_HOOK_EVENT) {
    return;
  }

  const entry = toPageHookFetchEntry(detail.payload);
  enqueuePageHookCapture(entry);
};

if (isWakeoUrl(window.location.href)) {
  window.addEventListener(PAGE_HOOK_EVENT, handlePageHookEvent);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "capture-request") {
    if (!isWakeoUrl(window.location.href)) {
      sendResponse({ ok: true, skipped: true, reason: "not-wakeo" });
      return false;
    }

    (async () => {
      const links = collectWakeoLinks();
      const shipmentFetchData = await collectShipmentFetchData();

      safeRuntimeSendMessage({ type: "capture-links", payload: { links } }, () => {
        if (!shipmentFetchData.length) {
          sendResponse({ ok: true, links: links.length, fetchData: 0 });
          return;
        }

        safeRuntimeSendMessage({ type: "capture-fetch-data", payload: { fetchData: shipmentFetchData } }, () => {
          sendResponse({ ok: true, links: links.length, fetchData: shipmentFetchData.length });
        });
      });
    })();

    return true;
  }

  return false;
});

chrome.storage.local.get({ recording: false }, (data) => {
  setContinuousCapture(Boolean(data.recording));
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.recording) {
    return;
  }

  setContinuousCapture(Boolean(changes.recording.newValue));
});
