(() => {
  const tokenListInput = document.getElementById("token-list");
  const tokenCountHint = document.getElementById("token-count");
  const tokenProcessButton = document.getElementById("token-process");
  const queuePauseButton = document.getElementById("queue-pause");
  const queueSettingsModal = document.getElementById("queue-settings-modal");
  const queueSettingsForm = document.getElementById("queue-settings-form");
  const queueSettingsEyebrow = document.getElementById("queue-settings-eyebrow");
  const queueSettingsTitle = document.getElementById("queue-settings-title");
  const queueSettingsSummary = document.getElementById("queue-settings-summary");
  const queueSettingsSubmit = document.getElementById("queue-settings-submit");
  const queueDwellMinInput = document.getElementById("queue-dwell-min");
  const queueDwellMaxInput = document.getElementById("queue-dwell-max");
  const queueBetweenMinInput = document.getElementById("queue-between-min");
  const queueBetweenMaxInput = document.getElementById("queue-between-max");
  const queueAutoSelectLabel = document.getElementById("queue-auto-select-label");
  const queueTokenLimitLabel = document.getElementById("queue-token-limit-label");
  const queueTokenLimitCount = document.getElementById("queue-token-limit-count");

  const TOKEN_SHIPMENT_URL_PREFIX = "https://app.wakeo.co/shipment/";
  const QUEUE_LOAD_FALLBACK_MS = 30000;
  const QUEUE_TIMER_STEP_MS = 500;
  const DEFAULT_TOKEN_QUEUE_SETTINGS = {
    dwellMinSeconds: 8,
    dwellMaxSeconds: 13,
    betweenMinSeconds: 2,
    betweenMaxSeconds: 3,
    tokenLimitCount: 5
  };

  let tokenQueueSettings = { ...DEFAULT_TOKEN_QUEUE_SETTINGS };
  let tokenQueueRunning = false;
  let tokenQueuePaused = false;
  let tokenResumeResolver = null;

  const parseTokens = () => {
    const rawValue = tokenListInput?.value || "";
    const tokens = rawValue
      .split(/[\s,;]+/)
      .map((token) => token.trim())
      .filter(Boolean);

    return [...new Set(tokens)];
  };

  const tokenToShipmentUrl = (token) => `${TOKEN_SHIPMENT_URL_PREFIX}${encodeURIComponent(token)}`;
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const randomBetween = (min, max) => min + Math.round(Math.random() * (max - min));
  const getRandomDwellWait = () =>
    randomBetween(tokenQueueSettings.dwellMinSeconds * 1000, tokenQueueSettings.dwellMaxSeconds * 1000);
  const getRandomBetweenWait = () =>
    randomBetween(tokenQueueSettings.betweenMinSeconds * 1000, tokenQueueSettings.betweenMaxSeconds * 1000);

  const setTokenCountUi = () => {
    const tokens = parseTokens();
    if (tokenCountHint) {
      tokenCountHint.textContent = `${tokens.length} token${tokens.length === 1 ? "" : "s"} ready`;
    }
    if (tokenProcessButton) {
      tokenProcessButton.disabled = tokenQueueRunning || !tokens.length;
    }
  };

  const setPauseUi = () => {
    if (!queuePauseButton || !tokenQueueRunning) return;
    queuePauseButton.disabled = false;
    queuePauseButton.textContent = tokenQueuePaused ? "Resume queue" : "Pause queue";
  };

  const waitIfPaused = () =>
    new Promise((resolve) => {
      if (!tokenQueuePaused) {
        resolve();
        return;
      }
      tokenResumeResolver = resolve;
    });

  const delayWithPause = async (durationMs) => {
    let remaining = durationMs;
    while (remaining > 0) {
      await waitIfPaused();
      const chunk = Math.min(QUEUE_TIMER_STEP_MS, remaining);
      await delay(chunk);
      remaining -= chunk;
    }
  };

  const waitForTabComplete = (tabId) =>
    new Promise((resolve) => {
      let resolved = false;

      const cleanup = () => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        clearTimeout(timeoutId);
      };

      const finish = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve();
      };

      const onUpdated = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === "complete") finish();
      };

      const timeoutId = setTimeout(finish, QUEUE_LOAD_FALLBACK_MS);
      chrome.tabs.onUpdated.addListener(onUpdated);

      chrome.tabs.get(tabId, (tab) => {
        if (!chrome.runtime.lastError && tab?.status === "complete") finish();
      });
    });

  const populateTimingInputs = () => {
    queueDwellMinInput.value = tokenQueueSettings.dwellMinSeconds;
    queueDwellMaxInput.value = tokenQueueSettings.dwellMaxSeconds;
    queueBetweenMinInput.value = tokenQueueSettings.betweenMinSeconds;
    queueBetweenMaxInput.value = tokenQueueSettings.betweenMaxSeconds;
  };

  const populateTokenLimitOptions = (totalCount) => {
    queueTokenLimitCount.innerHTML = "";
    tokenQueueSettings.tokenLimitCount = Math.max(1, Math.min(tokenQueueSettings.tokenLimitCount, totalCount));

    for (let index = 1; index <= totalCount; index += 1) {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = String(index);
      option.selected = index === tokenQueueSettings.tokenLimitCount;
      queueTokenLimitCount.appendChild(option);
    }
  };

  const openTokenModal = () => {
    if (tokenQueueRunning) return;
    const tokens = parseTokens();
    setTokenCountUi();

    if (!tokens.length) {
      tokenListInput?.focus();
      return;
    }

    if (queueSettingsEyebrow) queueSettingsEyebrow.textContent = "Token queue settings";
    if (queueSettingsTitle) queueSettingsTitle.textContent = "Process token list";
    if (queueSettingsSubmit) queueSettingsSubmit.textContent = "Start token queue";
    if (queueAutoSelectLabel) queueAutoSelectLabel.hidden = true;
    if (queueTokenLimitLabel) queueTokenLimitLabel.hidden = false;

    populateTimingInputs();
    populateTokenLimitOptions(tokens.length);

    const limit = Math.min(tokenQueueSettings.tokenLimitCount, tokens.length);
    queueSettingsSummary.textContent = `${tokens.length} token${tokens.length === 1 ? "" : "s"} detected. The first ${limit} token${limit === 1 ? "" : "s"} will be processed.`;
    queueSettingsModal.dataset.mode = "tokens";
    queueSettingsModal.hidden = false;
    queueDwellMinInput.focus();
    queueDwellMinInput.select();
  };

  const readSettingsFromForm = () => {
    const dwellMinSeconds = Math.max(1, Number(queueDwellMinInput.value) || DEFAULT_TOKEN_QUEUE_SETTINGS.dwellMinSeconds);
    const dwellMaxSeconds = Math.max(1, Number(queueDwellMaxInput.value) || DEFAULT_TOKEN_QUEUE_SETTINGS.dwellMaxSeconds);
    const betweenMinSeconds = Math.max(0, Number(queueBetweenMinInput.value) || DEFAULT_TOKEN_QUEUE_SETTINGS.betweenMinSeconds);
    const betweenMaxSeconds = Math.max(0, Number(queueBetweenMaxInput.value) || DEFAULT_TOKEN_QUEUE_SETTINGS.betweenMaxSeconds);
    const tokenLimitCount = Math.max(1, Number(queueTokenLimitCount.value) || tokenQueueSettings.tokenLimitCount);

    tokenQueueSettings = {
      dwellMinSeconds: Math.min(dwellMinSeconds, dwellMaxSeconds),
      dwellMaxSeconds: Math.max(dwellMinSeconds, dwellMaxSeconds),
      betweenMinSeconds: Math.min(betweenMinSeconds, betweenMaxSeconds),
      betweenMaxSeconds: Math.max(betweenMinSeconds, betweenMaxSeconds),
      tokenLimitCount
    };
  };

  const processTokenQueue = async () => {
    const tokens = parseTokens().slice(0, tokenQueueSettings.tokenLimitCount);
    if (!tokens.length) return;

    tokenQueueRunning = true;
    tokenQueuePaused = false;
    tokenProcessButton.disabled = true;
    tokenProcessButton.textContent = "Starting token queue...";
    setPauseUi();

    try {
      for (let index = 0; index < tokens.length; index += 1) {
        await waitIfPaused();
        const token = tokens[index];
        tokenProcessButton.textContent = `Opening ${index + 1}/${tokens.length}...`;

        await new Promise((resolve) => {
          chrome.tabs.create({ url: tokenToShipmentUrl(token), active: false }, async (tab) => {
            if (!tab?.id) {
              resolve();
              return;
            }

            await waitForTabComplete(tab.id);
            await waitIfPaused();
            tokenProcessButton.textContent = `Waiting ${index + 1}/${tokens.length}...`;
            await delayWithPause(getRandomDwellWait());
            chrome.tabs.remove(tab.id, () => resolve());
          });
        });

        if (index < tokens.length - 1) {
          tokenProcessButton.textContent = `Next token ${index + 2}/${tokens.length}...`;
          await delayWithPause(getRandomBetweenWait());
        }
      }
    } finally {
      tokenQueueRunning = false;
      tokenQueuePaused = false;
      tokenResumeResolver = null;
      tokenProcessButton.textContent = "Process token list";
      if (queuePauseButton) {
        queuePauseButton.disabled = true;
        queuePauseButton.textContent = "Pause queue";
      }
      setTokenCountUi();
    }
  };

  tokenListInput?.addEventListener("input", setTokenCountUi);
  tokenProcessButton?.addEventListener("click", openTokenModal);

  queueTokenLimitCount?.addEventListener("change", () => {
    tokenQueueSettings.tokenLimitCount = Math.max(1, Number(queueTokenLimitCount.value) || tokenQueueSettings.tokenLimitCount);
    const totalCount = parseTokens().length;
    const limit = Math.min(tokenQueueSettings.tokenLimitCount, totalCount);
    if (queueSettingsModal?.dataset.mode === "tokens") {
      queueSettingsSummary.textContent = `${totalCount} token${totalCount === 1 ? "" : "s"} detected. The first ${limit} token${limit === 1 ? "" : "s"} will be processed.`;
    }
  });

  queueSettingsForm?.addEventListener(
    "submit",
    (event) => {
      if (queueSettingsModal?.dataset.mode !== "tokens") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      readSettingsFromForm();
      queueSettingsModal.hidden = true;
      processTokenQueue();
    },
    true
  );

  queuePauseButton?.addEventListener(
    "click",
    (event) => {
      if (!tokenQueueRunning) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      tokenQueuePaused = !tokenQueuePaused;
      if (!tokenQueuePaused && tokenResumeResolver) {
        tokenResumeResolver();
        tokenResumeResolver = null;
      }
      setPauseUi();
    },
    true
  );

  document.querySelectorAll("[data-modal-close]").forEach((button) => {
    button.addEventListener("click", () => {
      if (queueSettingsModal?.dataset.mode === "tokens") {
        queueSettingsModal.dataset.mode = "";
      }
    });
  });

  setTokenCountUi();
})();
