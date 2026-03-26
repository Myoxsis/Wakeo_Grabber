(() => {
  if (window.__wakeoGrabberHookInstalled) {
    return;
  }

  window.__wakeoGrabberHookInstalled = true;

  const EVENT_TYPE = "wakeo-grabber-network-capture";

  const postPayload = (payload) => {
    try {
      window.dispatchEvent(
        new CustomEvent(EVENT_TYPE, {
          detail: {
            type: EVENT_TYPE,
            payload
          }
        })
      );
    } catch (error) {
      // Ignore payload serialization failures.
    }
  };

  const isWakeoApiEndpoint = (url) => {
    if (!url || typeof url !== "string") {
      return false;
    }

    try {
      const parsed = new URL(url, window.location.origin);
      const hostname = parsed.hostname.toLowerCase();
      const pathname = parsed.pathname;
      const isInternalWakeoApiHost = hostname === "internal.api.wakeo.co";
      const isOrderPath = /^\/api\/v1\/orders\/[a-f0-9]+\/?$/i.test(pathname);
      return isInternalWakeoApiHost && isOrderPath;
    } catch (error) {
      return false;
    }
  };

  const shouldCapture = (response, requestUrl) => {
    if (!response || !response.ok || !isWakeoApiEndpoint(requestUrl)) {
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
          .catch(() => {
            // Ignore JSON parse failures.
          });
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
        if (!isWakeoApiEndpoint(requestUrl) || this.status < 200 || this.status >= 300) {
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
      } catch (error) {
        // Ignore invalid payloads.
      }
    });

    return originalSend.apply(this, args);
  };
})();
