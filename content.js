const normalizeWhitespace = (text = "") => text.replace(/\s+/g, " ").trim();
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

const pickText = (root, selectors) => {
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    if (el && el.textContent) {
      const text = normalizeWhitespace(el.textContent);
      if (text) {
        return text;
      }
    }
  }
  return null;
};

const getPersonRoot = () =>
  document.querySelector(
    [
      "[itemtype*='Person']",
      "[data-person-id]",
      "[data-individu-id]",
      ".person-card",
      ".person-sheet",
      ".individu",
      ".tree-person",
      ".profile"
    ].join(", ")
  ) || document.body;

const extractPersonName = (root = document) => {
  const name = pickText(root, [
    "[data-person-name]",
    "[itemprop='name']",
    ".person-header__name",
    ".person__name",
    ".person-name",
    ".profile-name",
    ".individu-title",
    ".individu__title",
    ".fiche-identite h1",
    "h1",
    ".name",
    ".profile__name",
    ".tree-person__name"
  ]);
  if (name) {
    return name;
  }
  const metaTitle =
    root.querySelector("meta[property='og:title']")?.getAttribute("content") ||
    root.querySelector("meta[name='title']")?.getAttribute("content");
  return metaTitle || document.title || "Unknown individual";
};

const extractNameParts = (root, fullName) => {
  const firstName =
    pickText(root, [
      "[data-first-name]",
      "[itemprop='givenName']",
      ".person__firstname",
      ".person-firstname",
      ".individu__firstname",
      ".profile__firstname"
    ]) || null;
  const lastName =
    pickText(root, [
      "[data-last-name]",
      "[itemprop='familyName']",
      ".person__lastname",
      ".person-lastname",
      ".individu__lastname",
      ".profile__lastname"
    ]) || null;

  if (firstName || lastName) {
    return { firstName, lastName };
  }

  const cleaned = normalizeWhitespace(fullName || "");
  if (!cleaned) {
    return { firstName: null, lastName: null };
  }
  const tokens = cleaned.split(" ");
  if (tokens.length === 1) {
    return { firstName: tokens[0], lastName: null };
  }
  return {
    firstName: tokens.slice(0, -1).join(" "),
    lastName: tokens[tokens.length - 1]
  };
};

const extractDateByLabels = (root, labels) => {
  const labelRegex = new RegExp(`^(${labels.join("|")})`, "i");
  const labelNodes = root.querySelectorAll("dt, th, label, span, p, div");
  for (const node of labelNodes) {
    const label = normalizeWhitespace(node.textContent);
    if (!labelRegex.test(label)) {
      continue;
    }
    const sibling =
      node.nextElementSibling ||
      node.parentElement?.querySelector("dd, td, span, p, div");
    const value = sibling ? normalizeWhitespace(sibling.textContent) : null;
    if (value) {
      return value;
    }
  }
  return null;
};

const extractVitalDate = (root, prop, labels, selectors) => {
  const propEl = root.querySelector(`[itemprop='${prop}']`);
  if (propEl) {
    const content = propEl.getAttribute("content") || propEl.textContent;
    const normalized = normalizeWhitespace(content || "");
    if (normalized) {
      return normalized;
    }
  }

  const selectorText = pickText(root, selectors);
  if (selectorText) {
    return selectorText;
  }

  return extractDateByLabels(root, labels);
};

const extractRelationshipContext = (root) => {
  const relationSelectors = [
    "[data-relation]",
    "[data-relationship]",
    ".relationship",
    ".relation",
    ".relation-label",
    ".kinship",
    ".family-relation",
    ".person__relation",
    ".tree-person__relation"
  ];
  const relationText = pickText(root, relationSelectors);
  if (relationText) {
    return relationText;
  }

  const relationKeywords = [
    "father",
    "mother",
    "parent",
    "spouse",
    "husband",
    "wife",
    "child",
    "son",
    "daughter",
    "brother",
    "sister",
    "ancestor",
    "descendant"
  ];
  const relationRegex = new RegExp(`\\b(${relationKeywords.join("|")})\\b`, "i");
  const fallbackNodes = root.querySelectorAll("span, p, div, li");
  for (const node of fallbackNodes) {
    const text = normalizeWhitespace(node.textContent);
    if (relationRegex.test(text)) {
      return text;
    }
  }

  return null;
};

const extractPersonDetails = () => {
  const root = getPersonRoot();
  const fullName = extractPersonName(root);
  const { firstName, lastName } = extractNameParts(root, fullName);
  const birthDate = extractVitalDate(
    root,
    "birthDate",
    ["born", "birth", "né", "née", "naissance"],
    [
      "[data-birth]",
      ".birth-date",
      ".birth",
      "[data-event='birth']",
      ".person__birth",
      ".individu__birth"
    ]
  );
  const deathDate = extractVitalDate(
    root,
    "deathDate",
    ["died", "death", "décédé", "décédée", "décès", "mort"],
    [
      "[data-death]",
      ".death-date",
      ".death",
      "[data-event='death']",
      ".person__death",
      ".individu__death"
    ]
  );

  return {
    root,
    fullName,
    firstName,
    lastName,
    birthDate,
    deathDate
  };
};

const extractRelatives = () => {
  const relatives = { parents: [], spouses: [], children: [] };
  const sections = document.querySelectorAll("section, article, div");
  const addRelative = (type, entry) => {
    if (!entry || !entry.name) {
      return;
    }
    const cleaned = normalizeWhitespace(entry.name);
    if (!cleaned) {
      return;
    }
    const canonicalUrl = normalizeUrl(entry.url);
    const exists = relatives[type].some(
      (item) => item.canonicalUrl === canonicalUrl || item.name === cleaned
    );
    if (exists) {
      return;
    }
    relatives[type].push({
      name: cleaned,
      url: entry.url || null,
      canonicalUrl
    });
  };

  const getEntryFromNode = (node) => {
    if (!node) {
      return null;
    }
    const anchor = node.matches("a") ? node : node.querySelector("a[href]");
    if (anchor) {
      return { name: anchor.textContent, url: anchor.href };
    }
    return { name: node.textContent, url: null };
  };

  sections.forEach((section) => {
    const heading = pickText(section, ["h2", "h3", "h4", "[role='heading']"]);
    if (!heading) {
      return;
    }
    const lower = heading.toLowerCase();
    let target = null;
    if (lower.includes("parent") || lower.includes("father") || lower.includes("mother")) {
      target = "parents";
    } else if (lower.includes("spouse") || lower.includes("husband") || lower.includes("wife")) {
      target = "spouses";
    } else if (lower.includes("child") || lower.includes("children")) {
      target = "children";
    }

    if (!target) {
      return;
    }

    section.querySelectorAll("a, li, span, div").forEach((node) => {
      addRelative(target, getEntryFromNode(node));
    });
  });

  document.querySelectorAll("[data-relation], [data-relationship]").forEach((node) => {
    const relation = normalizeWhitespace(
      node.getAttribute("data-relation") || node.getAttribute("data-relationship") || ""
    ).toLowerCase();
    if (!relation) {
      return;
    }
    let target = null;
    if (relation.includes("parent") || relation.includes("father") || relation.includes("mother")) {
      target = "parents";
    } else if (relation.includes("spouse") || relation.includes("husband") || relation.includes("wife")) {
      target = "spouses";
    } else if (relation.includes("child") || relation.includes("son") || relation.includes("daughter")) {
      target = "children";
    }
    if (!target) {
      return;
    }
    addRelative(target, getEntryFromNode(node));
  });

  return relatives;
};

const captureProfile = (reason = "manual") => {
  const title = document.title || "Untitled profile";
  const url = window.location.href;
  const canonicalUrl = normalizeUrl(url);
  const selection = window.getSelection()?.toString().trim();
  const personDetails = extractPersonDetails();

  return {
    title,
    url,
    canonicalUrl,
    selection: selection || null,
    capturedAt: new Date().toISOString(),
    personName: personDetails.fullName,
    firstName: personDetails.firstName,
    lastName: personDetails.lastName,
    birthDate: personDetails.birthDate,
    deathDate: personDetails.deathDate,
    relationship: extractRelationshipContext(personDetails.root),
    relatives: extractRelatives(),
    reason
  };
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "capture-request") {
    const payload = captureProfile(message.reason || "manual");
    chrome.runtime.sendMessage({ type: "capture-profile", payload }, (response) => {
      sendResponse({ ok: true, response });
    });
    return true;
  }
  return false;
});
