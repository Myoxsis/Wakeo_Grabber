const historyList = document.getElementById("history");
const contentHistoryList = document.getElementById("content-history");
const contentDownloadAllButton = document.getElementById("content-download-all");
const contentSelectAllButton = document.getElementById("content-select-all");
const contentPreviewSelectedButton = document.getElementById("content-preview-selected");
const contentDownloadSelectedButton = document.getElementById("content-download-selected");
const contentDeleteSelectedButton = document.getElementById("content-delete-selected");
const contentSelectedPreview = document.getElementById("content-selected-preview");
const contentSelectedOutput = document.getElementById("content-selected-output");
const contentCopySelectedButton = document.getElementById("content-copy-selected");
const contentPathFilterCheckbox = document.getElementById("content-path-filter");
const recordButton = document.getElementById("record");
const recordingStatusPill = document.getElementById("recording-status");
const captureNowButton = document.getElementById("capture-now");
const autoProcessButton = document.getElementById("auto-process");
const selectAllButton = document.getElementById("select-all");
const deleteSelectedButton = document.getElementById("delete-selected");
const lockRightCheckbox = document.getElementById("lock-right");
const captureCountPill = document.getElementById("capture-count");
const selectionCountPill = document.getElementById("selection-count");
const contentCountPill = document.getElementById("content-count");
const tabButtons = [...document.querySelectorAll(".tab")];
const tabPanels = [...document.querySelectorAll(".tab-panel")];

const VIRTUAL_ROW_HEIGHT = 86;
const VIRTUAL_OVERSCAN = 6;
const LONG_QUEUE_WAIT_CHANCE = 0.15;

let selectedUrls = new Set();
let selectedContentKeys = new Set();
let contentPathFilterEnabled = false;
let latestCaptures = [];
let latestVisibleCapturedContent = [];

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

const storageGet = (defaults) =>
  new Promise((resolve) => chrome.storage.local.get(defaults, resolve));

const storageSet = (value) =>
  new Promise((resolve) => chrome.storage.local.set(value, resolve));

const queryActiveTab = () =>
  new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
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

const getRandomQueueOpenWait = () => {
  if (Math.random() < LONG_QUEUE_WAIT_CHANCE) return 15000;
  return 2000 + Math.round(Math.random() * 3000);
};

const getRandomQueueBetweenWait = () => 2000 + Math.round(Math.random() * 3000);

const collapseUrl = (url = "", maxLength = 72) => {
  if (!url || url.length <= maxLength) return url;
  try {
    const parsed = new URL(url);
    const compact = `${parsed.hostname}${parsed.pathname}`;
    if (compact.length <= maxLength) return compact;
    return `${compact.slice(0, Math.max(24, maxLength - 16))}…${compact.slice(-12)}`;
  } catch (error) {
    return `${url.slice(0, Math.max(24, maxLength - 16))}…${url.slice(-12)}`;
  }
};

const formatCapturedAt = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
};

const downloadJsonFile = (content, prefix = "wakeo-content") => {
  const blob = new Blob([content], { type: "application/json" });
  const blobUrl = URL.createObjectURL(blob);
  const downloadLink = document.createElement("a");
  const now = new Date().toISOString().replace(/[.:]/g, "-");
  downloadLink.href = blobUrl;
  downloadLink.download = `${prefix}-${now}.json`;
  downloadLink.click();
  URL.revokeObjectURL(blobUrl);
};

const setRecordingUi = (recording) => {
  recordButton.textContent = recording ? "Stop recording" : "Start recording";
  recordButton.classList.toggle("primary", !recording);
  recordButton.classList.toggle("ghost", recording);
  recordingStatusPill.textContent = recording ? "Recording active" : "Recording stopped";
  recordingStatusPill.classList.toggle("is-recording", recording);
};

const setStatsUi = (captures, capturedContent = []) => {
  captureCountPill.textContent = `${captures.length} link${captures.length === 1 ? "" : "s"}`;
  selectionCountPill.textContent = `${selectedUrls.size} selected`;
  contentCountPill.textContent = `${capturedContent.length} payload${capturedContent.length === 1 ? "" : "s"}`;
};

const getCaptureKey = (item) => item.canonicalUrl || normalizeUrl(item.url);

const areAllCapturesSelected = (captures) =>
  captures.length > 0 && captures.every((item) => selectedUrls.has(getCaptureKey(item)));

const setSelectionButtonsUi = (captures) => {
  const hasSelection = selectedUrls.size > 0;
  const hasItems = captures.length > 0;
  const allSelected = areAllCapturesSelected(captures);

  deleteSelectedButton.disabled = !hasSelection;
  autoProcessButton.disabled = !hasSelection;
  selectAllButton.disabled = !hasItems;
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

  contentDownloadAllButton.disabled = !hasItems;
  contentSelectAllButton.disabled = !hasItems;
  contentPreviewSelectedButton.disabled = !hasSelection;
  contentDownloadSelectedButton.disabled = !hasSelection;
  contentDeleteSelectedButton.disabled = !hasSelection;
  contentSelectAllButton.textContent = allSelected ? "Deselect all" : "Select all";
  contentSelectAllButton.setAttribute("aria-pressed", allSelected ? "true" : "false");
};

const toPathText = (value) => {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const normalized = value
      .map((part) => (typeof part === "string" ? part.trim() : String(part ?? "").trim()))
      .filter(Boolean)
      .join(" > ");
    return normalized || null;
  }
  return null;
};

const extractPathValue = (value) => {
  if (Array.isArray(value) && value.length && value.every((entry) => Array.isArray(entry))) {
    return value.map((entry) => toPathText(entry)).find(Boolean) || null;
  }
  return toPathText(value);
};

const getPathFromTransport = (transport) =>
  transport && typeof transport === "object" ? extractPathValue(transport.path) : null;

const getTransportPathValues = (data) => {
  if (!data || typeof data !== "object") return [];

  const transportPaths = Array.isArray(data.transports)
    ? data.transports.map((transport) => getPathFromTransport(transport)).filter(Boolean)
    : [];

  if (transportPaths.length) return transportPaths;

  const rootPath = extractPathValue(data.path);
  return rootPath ? [rootPath] : [];
};

const hasTransportPath = (item) => getTransportPathValues(item?.data).length > 0;

const filterPayloadToTransportsWithPath = (item) => {
  const transports = Array.isArray(item?.data?.transports) ? item.data.transports : null;
  if (!transports) return item;

  return {
    ...item,
    data: {
      ...item.data,
      transports: transports.filter((transport) => getPathFromTransport(transport))
    }
  };
};

const getVisibleCapturedContent = (capturedContent) =>
  contentPathFilterEnabled ? capturedContent.filter(hasTransportPath) : capturedContent;

const getSelectedCaptures = (captures) =>
  captures.filter((item) => selectedUrls.has(getCaptureKey(item)));

const getSelectedCapturedContent = (capturedContent) =>
  capturedContent.filter((item) => selectedContentKeys.has(getContentKey(item)));

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

const createEmptyState = (text) => {
  const emptyState = document.createElement("li");
  emptyState.className = "empty";
  emptyState.textContent = text;
  return emptyState;
};

const getVirtualWindow = (listElement, items) => {
  const viewportHeight = listElement.clientHeight || 280;
  const scrollTop = listElement.scrollTop || 0;
  const startIndex = Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN * 2;
  const endIndex = Math.min(items.length, startIndex + visibleCount);
  return { startIndex, endIndex };
};

const renderVirtualizedList = (listElement, items, emptyText, renderItem, setUiState) => {
  listElement.innerHTML = "";

  if (!items.length) {
    listElement.style.paddingTop = "";
    listElement.style.paddingBottom = "";
    listElement.appendChild(createEmptyState(emptyText));
    setUiState(items);
    return;
  }

  const { startIndex, endIndex } = getVirtualWindow(listElement, items);
  listElement.style.paddingTop = `${startIndex * VIRTUAL_ROW_HEIGHT}px`;
  listElement.style.paddingBottom = `${Math.max(0, (items.length - endIndex) * VIRTUAL_ROW_HEIGHT)}px`;

  items.slice(startIndex, endIndex).forEach((item) => {
    listElement.appendChild(renderItem(item, items));
  });

  setUiState(items);
};

const renderHistoryItem = (item, allItems) => {
  const key = getCaptureKey(item);
  const entry = document.createElement("li");

  const row = document.createElement("label");
  row.className = "history__row";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = selectedUrls.has(key);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) selectedUrls.add(key);
    else selectedUrls.delete(key);
    setStatsUi(latestCaptures, latestVisibleCapturedContent);
    setSelectionButtonsUi(allItems);
  });

  const rowContent = document.createElement("div");
  rowContent.className = "history__row-content";

  const link = document.createElement("a");
  link.href = item.url;
  link.textContent = collapseUrl(item.url);
  link.title = item.url;
  link.target = "_blank";

  const meta = document.createElement("span");
  meta.textContent = `${item.source || "unknown"} · ${formatCapturedAt(item.capturedAt)}`;

  rowContent.appendChild(link);
  rowContent.appendChild(meta);
  row.appendChild(checkbox);
  row.appendChild(rowContent);
  entry.appendChild(row);
  return entry;
};

const renderContentItem = (item, allItems) => {
  const key = getContentKey(item);
  const entry = document.createElement("li");
  const row = document.createElement("label");
  row.className = "history__row";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = selectedContentKeys.has(key);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) selectedContentKeys.add(key);
    else selectedContentKeys.delete(key);
    if (!selectedContentKeys.size) hideSelectedCapturedContent();
    setContentSelectionUi(allItems);
  });

  const rowContent = document.createElement("div");
  rowContent.className = "history__row-content";

  const pageLink = document.createElement("a");
  pageLink.href = item.pageUrl;
  pageLink.textContent = collapseUrl(item.pageUrl);
  pageLink.title = item.pageUrl;
  pageLink.target = "_blank";

  const meta = document.createElement("span");
  meta.textContent = `${item.source || "network-json"} · ${formatCapturedAt(item.capturedAt)}`;

  const request = document.createElement("span");
  request.textContent = `Request: ${collapseUrl(item.requestUrl || "unknown", 64)}`;
  request.title = item.requestUrl || "";

  const paths = getTransportPathValues(item.data);
  const pathSummary = document.createElement("span");
  if (paths.length) {
    pathSummary.className = "path-badge";
    pathSummary.textContent = paths.length === 1 ? `Path: ${paths[0]}` : `${paths.length} paths found`;
    pathSummary.title = paths.join("\n");
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
  return entry;
};

const renderHistory = (items) => {
  latestCaptures = items;
  renderVirtualizedList(
    historyList,
    items,
    "No pending shipment links. Start recording or click Capture now.",
    renderHistoryItem,
    setSelectionButtonsUi
  );
};

const renderCapturedContent = (items) => {
  latestVisibleCapturedContent = items;
  renderVirtualizedList(
    contentHistoryList,
    items,
    "No captured content yet. Open a shipment page while recording is active.",
    renderContentItem,
    (visibleItems) => {
      if (!visibleItems.length) hideSelectedCapturedContent();
      setContentSelectionUi(visibleItems);
    }
  );
};

const refreshHistory = async () => {
  const data = await storageGet({ capturedLinks: [], capturedFetchData: [] });
  const captures = data.capturedLinks || [];
  const capturedContent = data.capturedFetchData || [];
  const visibleCapturedContent = getVisibleCapturedContent(capturedContent);

  const validKeys = new Set(captures.map(getCaptureKey));
  const validContentKeys = new Set(capturedContent.map(getContentKey));
  selectedUrls = new Set([...selectedUrls].filter((key) => validKeys.has(key)));
  selectedContentKeys = new Set([...selectedContentKeys].filter((key) => validContentKeys.has(key)));

  renderHistory(captures);
  renderCapturedContent(visibleCapturedContent);
  setStatsUi(captures, visibleCapturedContent);
};

const captureCurrentTab = async (reason = "manual") => {
  const tab = await queryActiveTab();
  if (!tab?.id) return;
  await sendTabMessage(tab.id, { type: "capture-request", reason });
  await refreshHistory();
};

const processQueue = async () => {
  const data = await storageGet({ capturedLinks: [] });
  const captures = getSelectedCaptures(data.capturedLinks || []);
  if (!captures.length) return;

  autoProcessButton.disabled = true;
  autoProcessButton.textContent = "Processing...";

  for (let index = 0; index < captures.length; index += 1) {
    const capture = captures[index];
    const openWait = getRandomQueueOpenWait();
    autoProcessButton.textContent = `Processing ${index + 1}/${captures.length}...`;

    await new Promise((resolve) => {
      chrome.tabs.create({ url: capture.url, active: false }, (tab) => {
        setTimeout(() => {
          if (tab?.id) {
            chrome.tabs.remove(tab.id, () => resolve());
            return;
          }
          resolve();
        }, openWait);
      });
    });

    if (index < captures.length - 1) {
      await delay(getRandomQueueBetweenWait());
    }
  }

  autoProcessButton.textContent = "Auto process queue";
  await refreshHistory();
};

recordButton.addEventListener("click", async () => {
  const data = await storageGet({ recording: false });
  const nextRecording = !data.recording;
  await sendRuntimeMessage({ type: "set-recording", payload: { recording: nextRecording } });
  setRecordingUi(nextRecording);
  if (nextRecording) captureCurrentTab("manual");
});

captureNowButton.addEventListener("click", () => captureCurrentTab("manual"));
autoProcessButton.addEventListener("click", processQueue);

selectAllButton.addEventListener("click", async () => {
  const data = await storageGet({ capturedLinks: [] });
  const captures = data.capturedLinks || [];
  const shouldSelectAll = !areAllCapturesSelected(captures);
  selectedUrls = shouldSelectAll ? new Set(captures.map(getCaptureKey)) : new Set();
  renderHistory(captures);
  setStatsUi(captures, latestVisibleCapturedContent);
});

deleteSelectedButton.addEventListener("click", async () => {
  if (!selectedUrls.size || !confirm("Delete selected links?")) return;
  const data = await storageGet({ capturedLinks: [] });
  const captures = data.capturedLinks || [];
  const filtered = captures.filter((item) => !selectedUrls.has(getCaptureKey(item)));
  await storageSet({ capturedLinks: filtered });
  selectedUrls.clear();
  await refreshHistory();
});

contentSelectAllButton.addEventListener("click", async () => {
  const data = await storageGet({ capturedLinks: [], capturedFetchData: [] });
  const capturedContent = getVisibleCapturedContent(data.capturedFetchData || []);
  const shouldSelectAll = !areAllContentSelected(capturedContent);
  selectedContentKeys = shouldSelectAll ? new Set(capturedContent.map(getContentKey)) : new Set();
  renderCapturedContent(capturedContent);
  setStatsUi(data.capturedLinks || [], capturedContent);
});

contentDownloadAllButton.addEventListener("click", async () => {
  const data = await storageGet({ capturedFetchData: [] });
  const capturedContent = data.capturedFetchData || [];
  if (!capturedContent.length) return;
  downloadJsonFile(JSON.stringify(capturedContent, null, 2), "wakeo-content-all");
});

contentDownloadSelectedButton.addEventListener("click", async () => {
  const data = await storageGet({ capturedFetchData: [] });
  const selectedContent = getSelectedCapturedContent(data.capturedFetchData || []).map((item) =>
    contentPathFilterEnabled ? filterPayloadToTransportsWithPath(item) : item
  );
  if (!selectedContent.length) return;
  downloadJsonFile(JSON.stringify(selectedContent, null, 2), "wakeo-content-selected");
});

contentPreviewSelectedButton.addEventListener("click", async () => {
  const data = await storageGet({ capturedFetchData: [] });
  const selectedContent = getSelectedCapturedContent(data.capturedFetchData || []).map((item) =>
    contentPathFilterEnabled ? filterPayloadToTransportsWithPath(item) : item
  );
  if (!selectedContent.length) {
    hideSelectedCapturedContent();
    return;
  }
  showSelectedCapturedContent(JSON.stringify(selectedContent, null, 2));
});

contentDeleteSelectedButton.addEventListener("click", async () => {
  if (!selectedContentKeys.size || !confirm("Delete selected captured content?")) return;
  const data = await storageGet({ capturedFetchData: [] });
  const capturedContent = data.capturedFetchData || [];
  const filteredContent = capturedContent.filter((item) => !selectedContentKeys.has(getContentKey(item)));
  await storageSet({ capturedFetchData: filteredContent });
  selectedContentKeys.clear();
  hideSelectedCapturedContent();
  await refreshHistory();
});

contentCopySelectedButton.addEventListener("click", async () => {
  if (!contentSelectedOutput.value) return;
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
    renderHistory(latestCaptures);
    renderCapturedContent(latestVisibleCapturedContent);
  });
});

historyList.addEventListener("scroll", () => renderHistory(latestCaptures));
contentHistoryList.addEventListener("scroll", () => renderCapturedContent(latestVisibleCapturedContent));

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || (!changes.capturedLinks && !changes.capturedFetchData && !changes.recording)) return;
  if (changes.recording) setRecordingUi(Boolean(changes.recording.newValue));
  refreshHistory();
});

const initialize = async () => {
  const data = await storageGet({ recording: false, lockRightSide: false });
  setRecordingUi(Boolean(data.recording));
  lockRightCheckbox.checked = Boolean(data.lockRightSide);
  await refreshHistory();
};

initialize();
