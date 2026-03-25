const historyList = document.getElementById("history");
const recordButton = document.getElementById("record");
const clearButton = document.getElementById("clear");
const gedcomOutput = document.getElementById("gedcom");
const tabButtons = document.querySelectorAll(".tab");
const tabPanels = document.querySelectorAll(".tab-panel");

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

const formatRelativeList = (items) => {
  if (!items.length) {
    return "Unknown";
  }
  return items
    .map((item) => (typeof item === "string" ? item : item.name))
    .filter(Boolean)
    .join(", ");
};

const formatPersonName = (item) => {
  const first = item.firstName ? item.firstName.trim() : "";
  const last = item.lastName ? item.lastName.trim() : "";
  const combined = `${first} ${last}`.trim();
  if (combined) {
    return combined;
  }
  if (item.name) {
    return item.name;
  }
  return item.personName || item.title || "Unknown individual";
};

const formatLifeDates = (item) => {
  const birth = item.birthDate || "Unknown";
  const death = item.deathDate || "Unknown";
  return `Born: ${birth} · Died: ${death}`;
};

const formatGedcom = (captures) => {
  const lines = ["0 HEAD", "1 SOUR Geneanet Explorer", "1 GEDC", "2 VERS 5.5", "0 TRLR"];
  const individuals = new Map();
  const families = new Map();
  const familyLinks = new Map();

  const registerIndividual = (key, data, isCapture = false) => {
    if (individuals.has(key)) {
      const existing = individuals.get(key);
      if (isCapture) {
        existing.isCapture = true;
        existing.data = data;
      }
      return existing;
    }
    const id = `@I${individuals.size + 1}@`;
    const entry = { id, data, isCapture };
    individuals.set(key, entry);
    familyLinks.set(id, { spouseFamilies: new Set(), childFamilies: new Set() });
    return entry;
  };

  const ensureCaptureIndividual = (capture, fallbackIndex) => {
    const key = capture.canonicalUrl || normalizeUrl(capture.url) || `capture-${fallbackIndex}`;
    return registerIndividual(key, capture, true);
  };

  const ensureRelativeIndividual = (relative) => {
    const key = relative.canonicalUrl || normalizeUrl(relative.url);
    if (!key) {
      return null;
    }
    return registerIndividual(key, relative);
  };

  const addFamily = (key, payload) => {
    if (!families.has(key)) {
      const id = `@F${families.size + 1}@`;
      families.set(key, { id, ...payload, children: new Set(payload.children || []) });
      return families.get(key);
    }
    const family = families.get(key);
    if (payload.children) {
      payload.children.forEach((child) => family.children.add(child));
    }
    return family;
  };

  const uniqueCaptures = [];
  const seenUrls = new Set();
  captures.forEach((capture) => {
    const key = capture.canonicalUrl || normalizeUrl(capture.url);
    if (key && seenUrls.has(key)) {
      return;
    }
    if (key) {
      seenUrls.add(key);
    }
    uniqueCaptures.push(capture);
  });

  uniqueCaptures.forEach((capture, index) => {
    ensureCaptureIndividual(capture, index);
  });

  uniqueCaptures.forEach((capture, index) => {
    const entry = ensureCaptureIndividual(capture, index);
    const individualId = entry.id;
    const relativeGroups = capture.relatives || {};
    const parentIds = (relativeGroups.parents || [])
      .map((relative) => ensureRelativeIndividual(relative))
      .filter(Boolean)
      .map((relative) => relative.id);
    const spouseIds = (relativeGroups.spouses || [])
      .map((relative) => ensureRelativeIndividual(relative))
      .filter(Boolean)
      .map((relative) => relative.id);
    const childIds = (relativeGroups.children || [])
      .map((relative) => ensureRelativeIndividual(relative))
      .filter(Boolean)
      .map((relative) => relative.id);

    if (parentIds.length) {
      const key = `parents:${parentIds.slice().sort().join("|")}`;
      const family = addFamily(key, {
        spouses: parentIds,
        children: [individualId]
      });
      familyLinks.get(individualId).childFamilies.add(family.id);
      parentIds.forEach((parentId, idx) => {
        familyLinks.get(parentId).spouseFamilies.add(family.id);
        family.spouses[idx] = parentId;
      });
    }

    if (spouseIds.length) {
      spouseIds.forEach((spouseId) => {
        const key = `spouse:${[individualId, spouseId].slice().sort().join("|")}`;
        const family = addFamily(key, {
          spouses: [individualId, spouseId],
          children: childIds
        });
        familyLinks.get(individualId).spouseFamilies.add(family.id);
        familyLinks.get(spouseId).spouseFamilies.add(family.id);
      });
    } else if (childIds.length) {
      const key = `single-parent:${individualId}`;
      const family = addFamily(key, {
        spouses: [individualId],
        children: childIds
      });
      familyLinks.get(individualId).spouseFamilies.add(family.id);
    }
  });

  const individualRecords = [];
  individuals.forEach((entry, key) => {
    const record = [`0 ${entry.id} INDI`, `1 NAME ${formatPersonName(entry.data)}`];
    if (entry.isCapture) {
      if (entry.data.birthDate) {
        record.push("1 BIRT");
        record.push(`2 DATE ${entry.data.birthDate}`);
      }
      if (entry.data.deathDate) {
        record.push("1 DEAT");
        record.push(`2 DATE ${entry.data.deathDate}`);
      }
      if (entry.data.url) {
        record.push(`1 NOTE Captured from ${entry.data.url}`);
      }
      if (entry.data.relationship) {
        record.push(`1 NOTE Relation: ${entry.data.relationship}`);
      }
      if (entry.data.relatives) {
        record.push(`1 NOTE Parents: ${formatRelativeList(entry.data.relatives.parents || [])}`);
        record.push(`1 NOTE Spouses: ${formatRelativeList(entry.data.relatives.spouses || [])}`);
        record.push(`1 NOTE Children: ${formatRelativeList(entry.data.relatives.children || [])}`);
      }
    } else if (entry.data.url) {
      record.push(`1 NOTE Linked from ${entry.data.url}`);
    }

    const links = familyLinks.get(entry.id);
    if (links) {
      links.spouseFamilies.forEach((familyId) => {
        record.push(`1 FAMS ${familyId}`);
      });
      links.childFamilies.forEach((familyId) => {
        record.push(`1 FAMC ${familyId}`);
      });
    }

    individualRecords.push(record.join("\n"));
  });

  const familyRecords = [];
  families.forEach((family) => {
    const record = [`0 ${family.id} FAM`];
    if (family.spouses?.length) {
      const [first, second] = family.spouses;
      if (first) {
        record.push(`1 HUSB ${first}`);
      }
      if (second) {
        record.push(`1 WIFE ${second}`);
      }
    }
    family.children.forEach((childId) => {
      record.push(`1 CHIL ${childId}`);
    });
    familyRecords.push(record.join("\n"));
  });

  lines.splice(lines.length - 1, 0, ...individualRecords, ...familyRecords);

  return lines.join("\n");
};

const renderHistory = (items) => {
  historyList.innerHTML = "";

  if (!items.length) {
    const emptyState = document.createElement("li");
    emptyState.className = "empty";
    emptyState.textContent = "No captures yet. Select a profile and click capture.";
    historyList.appendChild(emptyState);
    return;
  }

  items.slice(0, 10).forEach((item) => {
    const entry = document.createElement("li");
    const link = document.createElement("a");
    link.href = item.url;
    link.textContent = formatPersonName(item);
    link.target = "_blank";

    const meta = document.createElement("span");
    meta.textContent = formatLifeDates(item);

    entry.appendChild(link);
    entry.appendChild(meta);
    historyList.appendChild(entry);
  });
};

const refreshHistory = () => {
  chrome.storage.local.get({ capturedProfiles: [] }, (data) => {
    const captures = data.capturedProfiles;
    renderHistory(captures);
    gedcomOutput.textContent = captures.length ? formatGedcom(captures) : "No GEDCOM data yet.";
  });
};

const setRecordingUi = (recording) => {
  recordButton.textContent = recording ? "Stop recording" : "Start recording";
  recordButton.classList.toggle("primary", !recording);
  recordButton.classList.toggle("ghost", recording);
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

const captureCurrentTab = async (reason) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: "capture-request", reason }, () => {
    refreshHistory();
  });
};

recordButton.addEventListener("click", toggleRecording);

clearButton.addEventListener("click", () => {
  chrome.storage.local.set({ capturedProfiles: [] }, () => {
    refreshHistory();
  });
});

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.dataset.tab;
    tabButtons.forEach((btn) => {
      btn.classList.toggle("active", btn === button);
      btn.setAttribute("aria-selected", btn === button ? "true" : "false");
    });
    tabPanels.forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.panel === target);
    });
  });
});

chrome.storage.local.get({ recording: false }, (data) => {
  setRecordingUi(data.recording);
});

refreshHistory();
