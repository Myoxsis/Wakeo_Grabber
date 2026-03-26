const historyList = document.getElementById("history");
const contentHistoryList = document.getElementById("content-history");
const contentSelectAllButton = document.getElementById("content-select-all");
const contentPreviewSelectedButton = document.getElementById("content-preview-selected");
const contentDownloadSelectedButton = document.getElementById("content-download-selected");
const contentDeleteSelectedButton = document.getElementById("content-delete-selected");
const contentSelectedPreview = document.getElementById("content-selected-preview");
const contentSelectedOutput = document.getElementById("content-selected-output");
const contentCopySelectedButton = document.getElementById("content-copy-selected");
const contentPathFilterCheckbox = document.getElementById("content-path-filter");
const recordButton = document.getElementById("record");
const captureNowButton = document.getElementById("capture-now");
const autoProcessButton = document.getElementById("auto-process");
const clearButton = document.getElementById("clear");
const selectAllButton = document.getElementById("select-all");
const deleteSelectedButton = document.getElementById("delete-selected");
const downloadSelectedButton = document.getElementById("download-selected");
const lockRightCheckbox = document.getElementById("lock-right");
const selectedContentSection = document.getElementById("selected-content");
const selectedContentOutput = document.getElementById("selected-content-output");
const copySelectedButton = document.getElementById("copy-selected");
const captureCountPill = document.getElementById("capture-count");
const selectionCountPill = document.getElementById("selection-count");
const contentCountPill = document.getElementById("content-count");
const tabButtons = [...document.querySelectorAll(".tab")];
const tabPanels = [...document.querySelectorAll(".tab-panel")];

let selectedUrls = new Set();
let selectedContentKeys = new Set();
let contentPathFilterEnabled = false;

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

const storageGet = (defaults) =>
  new Promise((resolve) => {
    chrome.storage.local.get(defaults, resolve);
  });

const storageSet = (value) =>
  new Promise((resolve) => {
    chrome.storage.local.set(value, resolve);
  });

const queryActiveTab = () =>
  new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0]);
    });
  });

const sendRuntimeMessage = (message) =>
  new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, reason: chrome.runtime.lastError.message });
        return;
      }

      resolve(response);
    });
  });

const sendTabMessage = (tabId, message) =>
  new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, reason: chrome.runtime.lastError.message });
        return;
      }

      resolve(response);
    });
  });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const areAllCapturesSelected = (captures) =>
  captures.length > 0 &&
  captures.every((item) => selectedUrls.has(item.canonicalUrl || normalizeUrl(item.url)));

const setRecordingUi = (recording) => {
  recordButton.textContent = recording ? "Stop recording" : "Start recording";
  recordButton.classList.toggle("primary", !recording);
  recordButton.classList.toggle("ghost", recording);
};

const setStatsUi = (captures, capturedContent = []) => {
  captureCountPill.textContent = `${captures.length} link${captures.length === 1 ? "" : "s"}`;
  selectionCountPill.textContent = `${selectedUrls.size} selected`;
  contentCountPill.textContent = `${capturedContent.length} payload${capturedContent.length === 1 ? "" : "s"}`;
};

const setSelectionButtonsUi = (captures) => {
  const hasSelection = selectedUrls.size > 0;
  const hasItems = captures.length > 0;
  const allSelected = areAllCapturesSelected(captures);

  deleteSelectedButton.disabled = !hasSelection;
  downloadSelectedButton.disabled = !hasSelection;
  autoProcessButton.disabled = !hasSelection;
  selectAllButton.disabled = !hasItems;
  clearButton.disabled = !hasItems;
  selectAllButton.textContent = allSelected ? "Deselect all" : "Select all";
  selectAllButton.setAttribute("aria-pressed", allSelected ? "true" : "false");
};

const getContentKey = (item) =>
  [item.pageUrl || "", item.requestUrl || "", item.capturedAt || ""].join("::");

const areAllContentSelected = (capturedContent) =>
  capturedContent.length > 0 && capturedContent.every((item) => selectedContentKeys.has(getContentKey(item)));

const setContentSelectionUi = (capturedContent) => {
  const hasItems = capturedContent.length > 0;
  const hasSelection = selectedContentKeys.size > 0;
  const allSelected = areAllContentSelected(capturedContent);

  contentSelectAllButton.disabled = !hasItems;
  contentPreviewSelectedButton.disabled = !hasSelection;
  contentDownloadSelectedButton.disabled = !hasSelection;
  contentDeleteSelectedButton.disabled = !hasSelection;
  contentSelectAllButton.textContent = allSelected ? "Deselect all content" : "Select all content";
  contentSelectAllButton.setAttribute("aria-pressed", allSelected ? "true" : "false");
};

const getSelectedCapturedContent = (capturedContent) =>
  capturedContent.filter((item) => selectedContentKeys.has(getContentKey(item)));

const toPathText = (value) => {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || null;
  }

  if (Array.isArray(value)) {
    const normalized = value
      .map((part) => (typeof part === "string" ? part.trim() : String(part ?? "").trim()))
      .filter(Boolean)
      .join(" > ");
    return normalized || null;
  }

  return null;
};

const getTransportPathValues = (data) => {
  if (!Array.isArray(data?.transports)) {
    return [];
  }

  return data.transports
    .map((transport) => toPathText(transport?.path))
    .filter(Boolean);
};

const hasTransportPath = (item) => getTransportPathValues(item?.data).length > 0;

const filterPayloadToTransportsWithPath = (item) => {
  const transports = Array.isArray(item?.data?.transports) ? item.data.transports : null;
  if (!transports) {
    return item;
  }

  const filteredTransports = transports.filter((transport) => toPathText(transport?.path));
  return {
    ...item,
    data: {
      ...item.data,
      transports: filteredTransports
    }
  };
};

const getVisibleCapturedContent = (capturedContent) =>
  contentPathFilterEnabled ? capturedContent.filter(hasTransportPath) : capturedContent;

const getSelectedCaptures = (captures) =>
  captures.filter((item) => selectedUrls.has(item.canonicalUrl || normalizeUrl(item.url)));

const showSelectedContent = (content) => {
  selectedContentOutput.value = content;
  selectedContentSection.hidden = false;
  selectedContentOutput.focus();
  selectedContentOutput.select();
};

const hideSelectedContent = () => {
  selectedContentSection.hidden = true;
  selectedContentOutput.value = "";
};

const showSelectedCapturedContent = (content) => {
  contentSelectedOutput.value = content;
  contentSelectedPreview.hidden = false;
  contentSelectedOutput.focus();
  contentSelectedOutput.select();
};

const hideSelectedCapturedContent = () => {
  contentSelectedPreview.hidden = true;
  contentSelectedOutput.value = "";
};

const downloadJsonFile = (content) => {
  const blob = new Blob([content], { type: "application/json" });
  const blobUrl = URL.createObjectURL(blob);
  const downloadLink = document.createElement("a");
  const now = new Date().toISOString().replace(/[.:]/g, "-");

  downloadLink.href = blobUrl;
  downloadLink.download = `wakeo-capture-${now}.json`;
  downloadLink.click();

  URL.revokeObjectURL(blobUrl);
};

const renderHistory = (items) => {
  historyList.innerHTML = "";

  if (!items.length) {
    const emptyState = document.createElement("li");
    emptyState.className = "empty";
    emptyState.textContent = "No shipment links in queue.";
    historyList.appendChild(emptyState);
    hideSelectedContent();
    setSelectionButtonsUi(items);
    return;
  }

  items.forEach((item) => {
    const key = item.canonicalUrl || normalizeUrl(item.url);
    const entry = document.createElement("li");

    const row = document.createElement("label");
    row.className = "history__row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedUrls.has(key);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedUrls.add(key);
      } else {
        selectedUrls.delete(key);
      }
      setStatsUi(items);
      setSelectionButtonsUi(items);
    });

    const link = document.createElement("a");
    link.href = item.url;
    link.textContent = item.url;
    link.target = "_blank";

    const meta = document.createElement("span");
    meta.textContent = `${item.source || "unknown"} · ${new Date(item.capturedAt).toLocaleString()}`;

    row.appendChild(checkbox);
    row.appendChild(link);
    entry.appendChild(row);
    entry.appendChild(meta);

    historyList.appendChild(entry);
  });

  setSelectionButtonsUi(items);
};

const renderCapturedContent = (items) => {
  contentHistoryList.innerHTML = "";

  if (!items.length) {
    const emptyState = document.createElement("li");
    emptyState.className = "empty";
    emptyState.textContent = "No shipment content yet.";
    contentHistoryList.appendChild(emptyState);
    hideSelectedCapturedContent();
    setContentSelectionUi(items);
    return;
  }

  items.forEach((item) => {
    const key = getContentKey(item);
    const entry = document.createElement("li");
    const row = document.createElement("label");
    row.className = "history__row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedContentKeys.has(key);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedContentKeys.add(key);
      } else {
        selectedContentKeys.delete(key);
      }
      if (!selectedContentKeys.size) {
        hideSelectedCapturedContent();
      }
      setContentSelectionUi(items);
    });

    const rowContent = document.createElement("div");
    rowContent.className = "history__row-content";

    const pageLink = document.createElement("a");
    pageLink.href = item.pageUrl;
    pageLink.textContent = item.pageUrl;
    pageLink.target = "_blank";

    const meta = document.createElement("span");
    meta.textContent = `${item.source || "network-json"} · ${new Date(item.capturedAt).toLocaleString()}`;

    const request = document.createElement("span");
    request.textContent = `Request: ${item.requestUrl}`;
    const paths = getTransportPathValues(item.data);
    const pathSummary = document.createElement("span");
    if (paths.length) {
      pathSummary.className = "path-badge";
      pathSummary.textContent = paths.length === 1 ? `Path: ${paths[0]}` : `${paths.length} paths found`;
    } else {
      pathSummary.textContent = "Path: none";
    }

    rowContent.appendChild(pageLink);
    rowContent.appendChild(meta);
    rowContent.appendChild(request);
    rowContent.appendChild(pathSummary);
    row.appendChild(checkbox);
    row.appendChild(rowContent);
    entry.appendChild(row);
    contentHistoryList.appendChild(entry);
  });

  setContentSelectionUi(items);
};

const refreshHistory = async () => {
  const data = await storageGet({ capturedLinks: [], capturedFetchData: [] });
  const captures = data.capturedLinks || [];
  const capturedContent = data.capturedFetchData || [];
  const visibleCapturedContent = getVisibleCapturedContent(capturedContent);
  const validKeys = new Set(captures.map((item) => item.canonicalUrl || normalizeUrl(item.url)));
  const validContentKeys = new Set(capturedContent.map(getContentKey));
  selectedUrls = new Set([...selectedUrls].filter((key) => validKeys.has(key)));
  selectedContentKeys = new Set([...selectedContentKeys].filter((key) => validContentKeys.has(key)));
  renderHistory(captures);
  renderCapturedContent(visibleCapturedContent);
  setStatsUi(captures, visibleCapturedContent);
};

const captureCurrentTab = async (reason) => {
  const tab = await queryActiveTab();
  if (!tab?.id) {
    return;
  }

  await sendTabMessage(tab.id, { type: "capture-request", reason });
  await refreshHistory();
};

const processQueue = async () => {
  const data = await storageGet({ capturedLinks: [] });
  const captures = getSelectedCaptures(data.capturedLinks || []);

  if (!captures.length) {
    return;
  }

  autoProcessButton.disabled = true;
  autoProcessButton.textContent = "Processing...";

  for (const capture of captures) {
    await new Promise((resolve) => {
      chrome.tabs.create({ url: capture.url, active: false }, (tab) => {
        const waitTime = 1200 + Math.round(Math.random() * 1800);
        setTimeout(() => {
          if (tab?.id) {
            chrome.tabs.remove(tab.id, () => resolve());
            return;
          }
          resolve();
        }, waitTime);
      });
    });

    await delay(500 + Math.round(Math.random() * 900));
  }

  autoProcessButton.textContent = "Auto process queue";
  await refreshHistory();
};

const toggleRecording = async () => {
  const data = await storageGet({ recording: false });
  const nextRecording = !data.recording;

  await sendRuntimeMessage({ type: "set-recording", payload: { recording: nextRecording } });
  setRecordingUi(nextRecording);

  if (nextRecording) {
    captureCurrentTab("manual");
  }
};

recordButton.addEventListener("click", toggleRecording);
captureNowButton.addEventListener("click", () => captureCurrentTab("manual"));
autoProcessButton.addEventListener("click", processQueue);

clearButton.addEventListener("click", async () => {
  if (!confirm("Clear all captured links?")) {
    return;
  }

  await storageSet({ capturedLinks: [] });
  selectedUrls.clear();
  hideSelectedContent();
  refreshHistory();
});

selectAllButton.addEventListener("click", async () => {
  const data = await storageGet({ capturedLinks: [] });
  const captures = data.capturedLinks || [];
  const shouldSelectAll = !areAllCapturesSelected(captures);

  selectedUrls = shouldSelectAll
    ? new Set(captures.map((item) => item.canonicalUrl || normalizeUrl(item.url)))
    : new Set();

  renderHistory(captures);
  setStatsUi(captures);
});

deleteSelectedButton.addEventListener("click", async () => {
  if (!selectedUrls.size || !confirm("Delete selected links?")) {
    return;
  }

  const data = await storageGet({ capturedLinks: [] });
  const captures = data.capturedLinks || [];
  const filtered = captures.filter(
    (item) => !selectedUrls.has(item.canonicalUrl || normalizeUrl(item.url))
  );

  await storageSet({ capturedLinks: filtered });
  selectedUrls.clear();
  hideSelectedContent();
  refreshHistory();
});

downloadSelectedButton.addEventListener("click", async () => {
  const data = await storageGet({ capturedLinks: [] });
  const captures = data.capturedLinks || [];
  const selected = getSelectedCaptures(captures);
  if (!selected.length) {
    return;
  }

  const content = JSON.stringify(selected, null, 2);
  showSelectedContent(content);
  downloadJsonFile(content);
});

copySelectedButton.addEventListener("click", async () => {
  if (!selectedContentOutput.value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(selectedContentOutput.value);
    copySelectedButton.textContent = "Copied";
    setTimeout(() => {
      copySelectedButton.textContent = "Copy";
    }, 1200);
  } catch (error) {
    selectedContentOutput.focus();
    selectedContentOutput.select();
  }
});

contentSelectAllButton.addEventListener("click", async () => {
  const data = await storageGet({ capturedFetchData: [] });
  const capturedContent = getVisibleCapturedContent(data.capturedFetchData || []);
  const shouldSelectAll = !areAllContentSelected(capturedContent);

  selectedContentKeys = shouldSelectAll ? new Set(capturedContent.map(getContentKey)) : new Set();

  renderCapturedContent(capturedContent);
});

contentDownloadSelectedButton.addEventListener("click", async () => {
  const data = await storageGet({ capturedFetchData: [] });
  const capturedContent = data.capturedFetchData || [];
  const selectedContent = getSelectedCapturedContent(capturedContent).map((item) =>
    contentPathFilterEnabled ? filterPayloadToTransportsWithPath(item) : item
  );

  if (!selectedContent.length) {
    return;
  }

  const content = JSON.stringify(selectedContent, null, 2);
  downloadJsonFile(content);
});

contentPreviewSelectedButton.addEventListener("click", async () => {
  const data = await storageGet({ capturedFetchData: [] });
  const capturedContent = data.capturedFetchData || [];
  const selectedContent = getSelectedCapturedContent(capturedContent).map((item) =>
    contentPathFilterEnabled ? filterPayloadToTransportsWithPath(item) : item
  );

  if (!selectedContent.length) {
    hideSelectedCapturedContent();
    return;
  }

  const content = JSON.stringify(selectedContent, null, 2);
  showSelectedCapturedContent(content);
});

contentDeleteSelectedButton.addEventListener("click", async () => {
  if (!selectedContentKeys.size || !confirm("Delete selected captured content?")) {
    return;
  }

  const data = await storageGet({ capturedFetchData: [] });
  const capturedContent = data.capturedFetchData || [];
  const filteredContent = capturedContent.filter((item) => !selectedContentKeys.has(getContentKey(item)));

  await storageSet({ capturedFetchData: filteredContent });
  selectedContentKeys.clear();
  hideSelectedCapturedContent();
  refreshHistory();
});

contentCopySelectedButton.addEventListener("click", async () => {
  if (!contentSelectedOutput.value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(contentSelectedOutput.value);
    contentCopySelectedButton.textContent = "Copied";
    setTimeout(() => {
      contentCopySelectedButton.textContent = "Copy";
    }, 1200);
  } catch (error) {
    contentSelectedOutput.focus();
    contentSelectedOutput.select();
  }
});

contentPathFilterCheckbox.addEventListener("change", async () => {
  contentPathFilterEnabled = contentPathFilterCheckbox.checked;
  hideSelectedCapturedContent();
  await refreshHistory();
});

lockRightCheckbox.addEventListener("change", async () => {
  const lockRightSide = lockRightCheckbox.checked;
  await sendRuntimeMessage({ type: "set-lock-right-side", payload: { lockRightSide } });

  if (lockRightSide && chrome.sidePanel?.open) {
    chrome.windows.getCurrent((window) => {
      chrome.sidePanel.open({ windowId: window.id });
    });
  }
});

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const tab = button.dataset.tab;
    tabButtons.forEach((node) => node.classList.toggle("is-active", node === button));
    tabPanels.forEach((panel) => {
      panel.hidden = panel.dataset.panel !== tab;
    });
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || (!changes.capturedLinks && !changes.capturedFetchData)) {
    return;
  }

  refreshHistory();
});

const initialize = async () => {
  const data = await storageGet({ recording: false, lockRightSide: false });
  setRecordingUi(data.recording);
  lockRightCheckbox.checked = data.lockRightSide;
  await refreshHistory();

  setInterval(refreshHistory, 1500);
};

initialize();
