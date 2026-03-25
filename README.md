# Wakeo Grabber
Chrome extension to capture only `app.wakeo.co` links from:
- the current page URL,
- links present in the DOM,
- and network resources visible through DevTools-like `performance` entries.

## Features
- Record mode for automatic capture while browsing Wakeo (including immediate capture when recording starts).
- Manual capture button.
- Captured links list with multi-select.
- Shipment page network JSON capture (`/shipment*` fetch/xhr resources).
- Mass delete selected items.
- Show selected items as JSON content (ready to copy).
- Optional "lock on the right side" behavior via Chrome Side Panel.

## Getting started
1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this repository folder.
4. Open Wakeo and use the extension popup.
