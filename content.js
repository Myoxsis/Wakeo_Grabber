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

const collectShipmentLinksFromShipmentsPage = () => {
  if (!window.location.pathname.startsWith("/shipments")) {
    return [];
  }

  const links = [];
  document.querySelectorAll('a[href^="/shipment"]').forEach((anchor) => {
    const absoluteUrl = new URL(anchor.getAttribute("href"), window.location.origin).toString();
    const entry = toLinkEntry(absoluteUrl, "shipments-list");
    if (entry) {
      links.push(entry);
    }
  });

  return links;
};

const collectWakeoLinks = () => {
  const links = [];
  const pushLink = (url, source) => {
    const entry = toLinkEntry(url, source);
    if (entry) {
      links.push(entry);
    }
  };

  pushLink(window.location.href, "page");

  document.querySelectorAll("a[href]").forEach((anchor) => {
    pushLink(anchor.href, "dom");
  });

  collectShipmentLinksFromShipmentsPage().forEach((entry) => links.push(entry));

  performance.getEntriesByType("resource").forEach((entry) => {
    if (entry?.name) {
      pushLink(entry.name, "network");
    }
  });

  return links;
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
  if (!window.location.pathname.startsWith("/shipment")) {
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
