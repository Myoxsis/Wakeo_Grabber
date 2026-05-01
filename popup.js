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
const selectAllButton = document.getElementById("select-all");
const deleteSelectedButton = document.getElementById("delete-selected");
const lockRightCheckbox = document.getElementById("lock-right");
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
  autoProcessButton.disabled = !hasSelection;
  selectAllButton.disabled = !hasItems;
  selectAllButton.textContent = allSelected ? "Deselect all" : "Select all";
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
};

const getSelectedCapturedContent = (capturedContent) =>
  capturedContent.filter((item) => selectedContentKeys.has(getContentKey(item)));

const getVisibleCapturedContent = (capturedContent) =>
  contentPathFilterEnabled ? capturedContent.filter((item) => item?.data?.transports?.length) : capturedContent;

const renderHistory = (items) => {
  historyList.innerHTML = "";

  items.forEach((item) => {
    const key = item.canonicalUrl || normalizeUrl(item.url);
    const entry = document.createElement("li");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedUrls.has(key);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedUrls.add(key);
      else selectedUrls.delete(key);
      setStatsUi(items);
    });

    const link = document.createElement("a");
    link.href = item.url;
    link.textContent = item.url;
    link.target = "_blank";

    entry.appendChild(checkbox);
    entry.appendChild(link);
    historyList.appendChild(entry);
  });

  setSelectionButtonsUi(items);
};

const renderCapturedContent = (items) => {
  contentHistoryList.innerHTML = "";

  items.forEach((item) => {
    const key = getContentKey(item);
    const entry = document.createElement("li");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedContentKeys.has(key);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedContentKeys.add(key);
      else selectedContentKeys.delete(key);
    });

    const link = document.createElement("a");
    link.href = item.pageUrl;
    link.textContent = item.pageUrl;

    entry.appendChild(checkbox);
    entry.appendChild(link);
    contentHistoryList.appendChild(entry);
  });

  setContentSelectionUi(items);
};

const refreshHistory = async () => {
  const data = await storageGet({ capturedLinks: [], capturedFetchData: [] });
  const captures = data.capturedLinks || [];
  const capturedContent = data.capturedFetchData || [];
  renderHistory(captures);
  renderCapturedContent(getVisibleCapturedContent(capturedContent));
  setStatsUi(captures, capturedContent);
};

const captureCurrentTab = async () => {
  const tab = await queryActiveTab();
  if (!tab?.id) return;
  await sendTabMessage(tab.id, { type: "capture-request" });
  await refreshHistory();
};

recordButton.addEventListener("click", async () => {
  const data = await storageGet({ recording: false });
  const next = !data.recording;
  await sendRuntimeMessage({ type: "set-recording", payload: { recording: next } });
  setRecordingUi(next);
});

captureNowButton.addEventListener("click", captureCurrentTab);

contentDownloadSelectedButton.addEventListener("click", async () => {
  const data = await storageGet({ capturedFetchData: [] });
  const selected = getSelectedCapturedContent(data.capturedFetchData || []);
  if (!selected.length) return;
  const content = JSON.stringify(selected, null, 2);
  const blob = new Blob([content]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "wakeo-content.json";
  a.click();
  URL.revokeObjectURL(url);
});

chrome.storage.onChanged.addListener(refreshHistory);

initialize();
