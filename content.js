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
const PAGE_HOOK_SCRIPT_ID = "wakeo-grabber-page-hook";
const MAX_CAPTURED_PAYLOADS = 150;

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
  chrome.runtime.sendMessage({ type: "capture-links", payload: { links } });
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

  try {
    chrome.runtime.sendMessage({ type: "capture-fetch-data", payload: { fetchData: payload } }, () => {
      flushPageHookQueue.inFlight = false;
      if (flushPageHookQueue.queue.length) {
        flushPageHookQueue();
      }
    });
  } catch (error) {
    flushPageHookQueue.inFlight = false;
  }
};
flushPageHookQueue.queue = [];
flushPageHookQueue.inFlight = false;

const enqueuePageHookCapture = (entry) => {
  if (!entry) {
    return;
  }

  flushPageHookQueue.queue.push(entry);
  if (flushPageHookQueue.queue.length > MAX_CAPTURED_PAYLOADS) {
    flushPageHookQueue.queue.shift();
  }

  flushPageHookQueue();
};

const handlePageHookEvent = (event) => {
  if (event.source !== window || event.origin !== window.location.origin) {
    return;
  }

  const detail = event.data?.detail;
  if (!detail || detail.type !== PAGE_HOOK_EVENT) {
    return;
  }

  const entry = toPageHookFetchEntry(detail.payload);
  enqueuePageHookCapture(entry);
};

const injectPageNetworkHook = () => {
  if (document.getElementById(PAGE_HOOK_SCRIPT_ID)) {
    return;
  }

  const script = document.createElement("script");
  script.id = PAGE_HOOK_SCRIPT_ID;
  script.type = "text/javascript";
  script.textContent = `(() => {
    if (window.__wakeoGrabberHookInstalled) {
      return;
    }
    window.__wakeoGrabberHookInstalled = true;

    const EVENT_TYPE = "${PAGE_HOOK_EVENT}";
    const postPayload = (payload) => {
      try {
        window.postMessage({ detail: { type: EVENT_TYPE, payload } }, window.location.origin);
      } catch (error) {}
    };

    const isShipmentEndpoint = (url) => {
      if (!url || typeof url !== "string") {
        return false;
      }

      try {
        const parsed = new URL(url, window.location.origin);
        const normalized = parsed.toString().toLowerCase();
        return parsed.hostname === "app.wakeo.co" &&
          (normalized.includes("/shipment") || normalized.includes("/shipments"));
      } catch (error) {
        return false;
      }
    };

    const shouldCapture = (response, requestUrl) => {
      if (!response || !response.ok || !isShipmentEndpoint(requestUrl)) {
        return false;
      }
      const contentType = response.headers?.get?.("content-type") || "";
      return contentType.toLowerCase().includes("application/json");
    };

    const originalFetch = window.fetch;
    if (typeof originalFetch === "function") {
      window.fetch = async (...args) => {
        const response = await originalFetch.apply(window, args);
        const requestUrl = response?.url || args?.[0]?.url || String(args?.[0] || "");

        if (shouldCapture(response, requestUrl)) {
          response
            .clone()
            .json()
            .then((data) => {
              postPayload({
                requestUrl,
                source: "page-fetch-hook",
                capturedAt: new Date().toISOString(),
                data
              });
            })
            .catch(() => {});
        }

        return response;
      };
    }

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this.__wakeoGrabberRequestUrl = typeof url === "string" ? url : "";
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function(...args) {
      this.addEventListener("load", () => {
        try {
          const requestUrl = this.responseURL || this.__wakeoGrabberRequestUrl || "";
          if (!isShipmentEndpoint(requestUrl) || this.status < 200 || this.status >= 300) {
            return;
          }

          const contentType = this.getResponseHeader("content-type") || "";
          if (!contentType.toLowerCase().includes("application/json")) {
            return;
          }

          const text = typeof this.responseText === "string" ? this.responseText : "";
          if (!text) {
            return;
          }

          postPayload({
            requestUrl,
            source: "page-xhr-hook",
            capturedAt: new Date().toISOString(),
            data: JSON.parse(text)
          });
        } catch (error) {}
      });

      return originalSend.apply(this, args);
    };
  })();`;

  (document.documentElement || document.head || document.body).appendChild(script);
  script.remove();
};

if (isWakeoUrl(window.location.href)) {
  window.addEventListener("message", handlePageHookEvent);
  injectPageNetworkHook();
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

      chrome.runtime.sendMessage({ type: "capture-links", payload: { links } }, () => {
        if (!shipmentFetchData.length) {
          sendResponse({ ok: true, links: links.length, fetchData: 0 });
          return;
        }

        chrome.runtime.sendMessage(
          { type: "capture-fetch-data", payload: { fetchData: shipmentFetchData } },
          () => {
            sendResponse({ ok: true, links: links.length, fetchData: shipmentFetchData.length });
          }
        );
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
