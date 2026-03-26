# Wakeo Grabber
Chrome extension to capture only `app.wakeo.co` links from:
- the current page URL,
- links present in the DOM,
- and network resources visible through DevTools-like `performance` entries.

## Features
- Record mode for automatic capture while browsing Wakeo (including immediate capture when recording starts).
- Manual capture button.
- Captured links list with multi-select.
- Automatic pruning of links once shipment content has been captured for them.
- Shipment page network JSON capture from Wakeo API fetch/xhr resources, including `internal.api.wakeo.co` endpoints.
- In-page fetch/XHR interception to capture the same shipment JSON payloads visible in DevTools network responses.
- Dedicated section in popup to review captured shipment content payloads.
- Path visibility for captured transports (shows path when present and non-empty).
- Toggle filter to display only captured content that contains transports with non-empty path values.
- Mass delete selected items.
- Export selected items as JSON file + copy-ready preview.
- Live counters for total captured links and current selection.
- Optional "lock on the right side" behavior via Chrome Side Panel.

## Getting started
1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this repository folder.
4. Open Wakeo and use the extension popup.
