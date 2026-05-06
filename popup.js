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
const queuePauseButton = document.getElementById("queue-pause");
const selectAllButton = document.getElementById("select-all");
const deleteSelectedButton = document.getElementById("delete-selected");
const lockRightCheckbox = document.getElementById("lock-right");
const captureCountPill = document.getElementById("capture-count");
const selectionCountPill = document.getElementById("selection-count");
const contentCountPill = document.getElementById("content-count");
const tabButtons = [...document.querySelectorAll(".tab")];
const tabPanels = [...document.querySelectorAll(".tab-panel")];
const queueSettingsModal = document.getElementById("queue-settings-modal");
const queueSettingsForm = document.getElementById("queue-settings-form");
const queueSettingsSummary = document.getElementById("queue-settings-summary");
const queueDwellMinInput = document.getElementById("queue-dwell-min");
const queueDwellMaxInput = document.getElementById("queue-dwell-max");
const queueBetweenMinInput = document.getElementById("queue-between-min");
const queueBetweenMaxInput = document.getElementById("queue-between-max");
const queueAutoSelectCount = document.getElementById("queue-auto-select-count");
const modalCloseButtons = [...document.querySelectorAll("[data-modal-close]")];

const VIRTUAL_ROW_HEIGHT = 86;
const VIRTUAL_OVERSCAN = 6;
const QUEUE_LOAD_FALLBACK_MS = 30000;
const QUEUE_TIMER_STEP_MS = 500;

const DEFAULT_QUEUE_SETTINGS = {
  dwellMinSeconds: 8,
  dwellMaxSeconds: 13,
  betweenMinSeconds: 2,
  betweenMaxSeconds: 3,
  autoSelectCount: 5
};

let queueSettings = { ...DEFAULT_QUEUE_SETTINGS };

const getRandomQueueDwellWait = () =>
  randomBetween(queueSettings.dwellMinSeconds * 1000, queueSettings.dwellMaxSeconds * 1000);

const getRandomQueueBetweenWait = () =>
  randomBetween(queueSettings.betweenMinSeconds * 1000, queueSettings.betweenMaxSeconds * 1000);

const openQueueSettingsModal = async () => {
  const data = await storageGet({ capturedLinks: [] });
  const captures = data.capturedLinks || [];
  const selectedCount = getSelectedCaptures(captures).length;

  queueDwellMinInput.value = queueSettings.dwellMinSeconds;
  queueDwellMaxInput.value = queueSettings.dwellMaxSeconds;
  queueBetweenMinInput.value = queueSettings.betweenMinSeconds;
  queueBetweenMaxInput.value = queueSettings.betweenMaxSeconds;

  queueAutoSelectCount.innerHTML = "";

  const maxSelectable = Math.max(1, captures.length);
  for (let index = 1; index <= maxSelectable; index += 1) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = String(index);
    if (index === queueSettings.autoSelectCount) option.selected = true;
    queueAutoSelectCount.appendChild(option);
  }

  queueSettingsSummary.textContent = selectedCount
    ? `${selectedCount} selected link${selectedCount > 1 ? "s" : ""} will be processed.`
    : `No links selected. The first ${Math.min(queueSettings.autoSelectCount, captures.length || queueSettings.autoSelectCount)} pending links will be auto-selected.`;

  queueSettingsModal.hidden = false;
};

const closeQueueSettingsModal = () => {
  queueSettingsModal.hidden = true;
};
