const historyList = document.getElementById("history");
const recordButton = document.getElementById("record");
const captureNowButton = document.getElementById("capture-now");
const clearButton = document.getElementById("clear");
const selectAllButton = document.getElementById("select-all");
const deleteSelectedButton = document.getElementById("delete-selected");
const downloadSelectedButton = document.getElementById("download-selected");
const lockRightCheckbox = document.getElementById("lock-right");

let selectedUrls = new Set();

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

const setRecordingUi = (recording) => {
  recordButton.textContent = recording ? "Stop recording" : "Start recording";
  recordButton.classList.toggle("primary", !recording);
  recordButton.classList.toggle("ghost", recording);
};

const setSelectionButtonsUi = (captures) => {
  const hasSelection = selectedUrls.size > 0;
  const hasItems = captures.length > 0;
  deleteSelectedButton.disabled = !hasSelection;
  downloadSelectedButton.disabled = !hasSelection;
  selectAllButton.disabled = !hasItems;
  clearButton.disabled = !hasItems;
};

const getSelectedCaptures = (captures) =>
  captures.filter((item) => selectedUrls.has(item.canonicalUrl || normalizeUrl(item.url)));

const renderHistory = (items) => {
  historyList.innerHTML = "";

  if (!items.length) {
    const emptyState = document.createElement("li");
    emptyState.className = "empty";
    emptyState.textContent = "No Wakeo links yet. Open Wakeo.com and capture.";
    historyList.appendChild(emptyState);
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

const refreshHistory = () => {
  chrome.storage.local.get({ capturedLinks: [] }, (data) => {
    const captures = data.capturedLinks || [];
    const validKeys = new Set(captures.map((item) => item.canonicalUrl || normalizeUrl(item.url)));
    selectedUrls = new Set([...selectedUrls].filter((key) => validKeys.has(key)));
    renderHistory(captures);
  });
};

const captureCurrentTab = async (reason) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: "capture-request", reason }, () => {
    refreshHistory();
  });
};

const toggleRecording = () => {
  chrome.storage.local.get({ recording: false }, (data) => {
    const nextRecording = !data.recording;
    chrome.runtime.sendMessage(
      { type: "set-recording", payload: { recording: nextRecording } },
      () => {
        setRecordingUi(nextRecording);
        if (nextRecording) {
          captureCurrentTab("manual");
        }
      }
    );
  });
};

recordButton.addEventListener("click", toggleRecording);

captureNowButton.addEventListener("click", () => {
  captureCurrentTab("manual");
});

clearButton.addEventListener("click", () => {
  chrome.storage.local.set({ capturedLinks: [] }, () => {
    selectedUrls.clear();
    refreshHistory();
  });
});

selectAllButton.addEventListener("click", () => {
  chrome.storage.local.get({ capturedLinks: [] }, (data) => {
    const captures = data.capturedLinks || [];
    const shouldSelectAll = selectedUrls.size !== captures.length;
    selectedUrls = shouldSelectAll
      ? new Set(captures.map((item) => item.canonicalUrl || normalizeUrl(item.url)))
      : new Set();
    renderHistory(captures);
  });
});

deleteSelectedButton.addEventListener("click", () => {
  chrome.storage.local.get({ capturedLinks: [] }, (data) => {
    const captures = data.capturedLinks || [];
    const filtered = captures.filter(
      (item) => !selectedUrls.has(item.canonicalUrl || normalizeUrl(item.url))
    );
    chrome.storage.local.set({ capturedLinks: filtered }, () => {
      selectedUrls.clear();
      refreshHistory();
    });
  });
});

downloadSelectedButton.addEventListener("click", () => {
  chrome.storage.local.get({ capturedLinks: [] }, (data) => {
    const captures = data.capturedLinks || [];
    const selected = getSelectedCaptures(captures);
    if (!selected.length) {
      return;
    }

    const blob = new Blob([JSON.stringify(selected, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wakeo-links-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
});

lockRightCheckbox.addEventListener("change", () => {
  const lockRightSide = lockRightCheckbox.checked;
  chrome.runtime.sendMessage({ type: "set-lock-right-side", payload: { lockRightSide } });

  if (lockRightSide && chrome.sidePanel?.open) {
    chrome.windows.getCurrent((window) => {
      chrome.sidePanel.open({ windowId: window.id });
    });
  }
});

chrome.storage.local.get({ recording: false, lockRightSide: false }, (data) => {
  setRecordingUi(data.recording);
  lockRightCheckbox.checked = data.lockRightSide;
});

refreshHistory();
