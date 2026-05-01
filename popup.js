// ADD BELOW existing constants
let queuePaused = false;
let resumeResolver = null;

const waitIfPaused = () =>
  new Promise((resolve) => {
    if (!queuePaused) return resolve();
    resumeResolver = resolve;
  });

// ADD button reference
const queuePauseButton = document.getElementById("queue-pause");

queuePauseButton.addEventListener("click", () => {
  queuePaused = !queuePaused;

  if (!queuePaused && resumeResolver) {
    resumeResolver();
    resumeResolver = null;
  }

  queuePauseButton.textContent = queuePaused ? "Resume queue" : "Pause queue";
});

// MODIFY processQueue function
const processQueue = async () => {
  const data = await storageGet({ capturedLinks: [] });
  const captures = getSelectedCaptures(data.capturedLinks || []);
  if (!captures.length) return;

  autoProcessButton.disabled = true;
  queuePauseButton.disabled = false;
  autoProcessButton.textContent = "Processing...";

  for (let index = 0; index < captures.length; index += 1) {
    await waitIfPaused();

    const capture = captures[index];
    autoProcessButton.textContent = `Opening ${index + 1}/${captures.length}...`;

    await new Promise((resolve) => {
      chrome.tabs.create({ url: capture.url, active: false }, async (tab) => {
        if (!tab?.id) {
          resolve();
          return;
        }

        await waitForTabComplete(tab.id);
        await waitIfPaused();

        autoProcessButton.textContent = `Waiting ${index + 1}/${captures.length}...`;

        let remaining = getRandomQueueDwellWait();
        const step = 500;

        while (remaining > 0) {
          await waitIfPaused();
          const chunk = Math.min(step, remaining);
          await delay(chunk);
          remaining -= chunk;
        }

        chrome.tabs.remove(tab.id, () => resolve());
      });
    });

    if (index < captures.length - 1) {
      let remaining = getRandomQueueBetweenWait();

      while (remaining > 0) {
        await waitIfPaused();
        const chunk = Math.min(500, remaining);
        await delay(chunk);
        remaining -= chunk;
      }
    }
  }

  autoProcessButton.textContent = "Auto process queue";
  queuePauseButton.disabled = true;
  queuePaused = false;
  await refreshHistory();
};
