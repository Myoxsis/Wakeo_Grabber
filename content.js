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

const toLinkEntry = (url, source) => {
  const canonicalUrl = normalizeUrl(url);
  if (!canonicalUrl || !isWakeoUrl(canonicalUrl)) {
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

  performance.getEntriesByType("resource").forEach((entry) => {
    if (entry?.name) {
      pushLink(entry.name, "network");
    }
  });

  return links;
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "capture-request") {
    if (!isWakeoUrl(window.location.href)) {
      sendResponse({ ok: true, skipped: true, reason: "not-wakeo" });
      return false;
    }

    const links = collectWakeoLinks();
    chrome.runtime.sendMessage({ type: "capture-links", payload: { links } }, (response) => {
      sendResponse({ ok: true, response });
    });
    return true;
  }

  return false;
});
