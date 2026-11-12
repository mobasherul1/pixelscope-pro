# PixelScope Pro — Meta Pixel & CAPI Doctor

**The best free alternative to Meta Pixel Helper (now Meta Ads Data Advisor) for Chrome, Brave, Microsoft Edge, and any other Chromium-based browser.**

PixelScope Pro is a deep-audit browser extension that shows you, for any website you visit, **which Meta Pixel ID(s) it has and exactly what data it is collecting** — and what is broken about it, with the exact fix to paste in.

- **Version:** 1.7.0 (stable, November 2026)
- **Type:** Chrome Extension, Manifest V3 — works on Chrome, Brave, Edge, and other Chromium browsers
- **Made by:** Mobasher (Mobasherul Hasan) — Lab-C, November 2026
- **Website:** https://m1shop.netlify.app
- **No login. No server. No data leaves your browser.**

> Not affiliated with Meta. It does not run ads, manage ads, or auto-install anything on your site.

---

## What it does

Open any website, click the PixelScope icon, and the side panel tells you:

1. **Which Meta Pixel ID(s) the site has** — found from every source, not just one:
   `fbq('init')` calls, `fbq.instance.pixelsByID`, the Pixel config URL, the page code, and the `<noscript>` fallback. Silent, duplicate, and old-agency Pixels are included, not hidden.
2. **What data it is collecting** — every event the site fires, and for each one: all parameters (`value`, `currency`, `content_ids`, custom data), Advanced Matching / customer data (hashed), `_fbp` / `_fbc` cookies, `event_id`, page URL, referrer, SDK version, HTTP status, and whether the hit was blocked.
3. **What is broken** — with a copy-paste fix for every issue (see [Health Score & issues](#health-score--issues) below).

That is the whole job. It is an audit tool, not an ads manager and not a setup wizard.

---

## Features — and how each one works

### 1. Pixel detection (all sources)
The extension scans the page in the main world (`fbq.instance.pixelsByID`, `_fbp`/`_fbc` cookies, noscript Pixel IDs, GTM IDs) and watches `fbq('init')` calls, so it finds Pixels that a single-source checker misses — including a second Pixel, a duplicate, or one loaded late by Google Tag Manager. Each Pixel gets its own card with its ID, source, event count, and a link to Events Manager.

### 2. Real network capture — ground truth
`background.js` captures the actual `facebook.com/tr` network hits with `webRequest` — **GET and POST**, with request body, HTTP status, and blocked-request errors.
- What `fbq()` says is what the page *called*.
- What `/tr` says is what Meta *actually received*.

If the two disagree, PixelScope flags it instead of guessing.

### 3. Live event timeline
Every event is listed as it fires, with its name, time, Pixel, page URL, and parameters. First 6 events are shown, then **Show all / Show fewer**. Each event expands Meta-style: Event info (Setup method, Pixel code, Pixel location, Frame, URL called, Load time), Parameters, Details, Issues, and **Copy JSON / Copy Pixel ID**.

### 4. Health Score (0–100)
Every page gets a score with a full breakdown — not just ok / warn / error. Points are deducted for real problems: missing value or currency, missing `content_ids`, missing or misplaced `event_id`, duplicate events, PII in plain text, wrong value format, wrong currency, case-sensitive event names, and blocked hits. The score bar explains every deduction.

### 5. Deep Audit tab
The main purpose of the tool. It aggregates everything across all events into one data inventory: which fields are collected, how often, and what is missing — coverage for value, currency, product IDs, `event_id`, `_fbp`, and PII, plus Pixel sources. This is the view to use when you need to answer "what is this site actually sending to Meta?"

### 6. "Called, never sent"
If a page calls `fbq()` but no matching network hit arrives within 3 seconds, the event is flagged **Called, never sent**. That catches blocked, consent-held, or mock `fbq` calls that a network-only checker never sees at all.

### 7. Issue detection — with the fix, not just the warning
PixelScope checks for, among others:
- Duplicate Pixel / duplicate event (same event within 3 seconds)
- Missing, zero, or negative `value`; missing `currency`; wrong currency code (checked against a full 158-code ISO list)
- Missing `content_ids`, or `content_ids` that is not a valid JSON array; `contents` without `id`s
- Missing or misplaced `event_id` — `eventID` inside the params object is caught and explained (the network never sees it as `eid`, so other tools just say "no event_id")
- Value that is not a plain number (`"$29.99"` is rejected)
- Case-sensitive event names (`purchase` vs `Purchase`)
- Raw email / phone in parameters — flagged as PII in plain text
- Missing `_fbp` cookie, HTTP page, HTTP status ≥ 400
- Consent revoked / ad-blocker blocking

Every issue comes with the exact correction to paste into the site's code.

### 8. Funnel — PageView → Purchase
A funnel view follows the standard shopping journey (PageView → ViewContent → AddToCart → InitiateCheckout → Purchase) and shows where visitors drop off and which step's events are missing or broken.

### 9. Conversions API (CAPI) tab
- Payload preview for server-side events
- Deduplication check: browser event + CAPI event with the same `event_id` are matched, so you can see whether deduplication will actually work
- EMQ (Event Match Quality) estimate

### 10. Install-code generator & test-fire buttons
- Generates the Pixel install code for the detected Pixel ID, ready to copy
- Test-fire buttons let you fire a test event from the panel and watch it appear in the timeline, so you can check the setup without going through a full checkout

### 11. Other trackers
Detects the other tags on the page too: Google Tag Manager, GA4 / Google Ads, TikTok, Snapchat, Pinterest, and LinkedIn — so you can see the full tracking picture, not just Meta.

### 12. Platform detection
Detects how the Pixel was installed: Manual, GTM, WooCommerce, Shopify, or WordPress — shown as the **Setup method** on every event.

### 13. Copy everything
Every row has a copy button — Pixel ID, Setup method, Pixel code, Pixel location, Frame, URL called, Load time, every Parameter row, every Details row, every event (Copy event / Copy JSON). **Copy all** copies the full audit report (Pixel IDs, health, checks, all events with parameters and issues) in one tap.

### 14. Ad-blocker / extension checker
Three local signals — a bait ad element hidden by an extension, the Pixel script present but `fbq` never loading, a failed fetch to `connect.facebook.net`, and a network hit blocked by an extension (`ERR_BLOCKED_BY_CLIENT`) — trigger a yellow banner: *"An extension or adblocker is running, kindly turn it off…"*

### 15. Audit history
Each check is saved per domain (last 20 visits), so you can compare a site before and after a fix.

### 16. Export
Export the audit as a report, JSON, or CSV from the panel.

### 17. Themes — including a Meta theme
Light, Dark, Eye care (warm, low-blue-light), Emerald, and **Meta** — a theme that looks exactly like Meta Pixel Helper (soft blue-grey background, white cards, Meta blue #1877f2), for users used to the official tool. In Meta mode the panel shows only what Meta shows; picking any other theme brings all PixelScope tools back instantly.

### 18. Settings
Light / Dark / Auto / Eye care / Meta theme, badge counts events *or* issues, keep events across page loads (vital for checkout / redirect flows), hide automatic events, and search + filter (All / Issues / Standard / Custom / Automatic).

---

## Why it exists — what Meta Pixel Helper gets wrong

Meta Ads Data Advisor (formerly Meta Pixel Helper, v5.13.0, 3 Nov 2026) detects a Pixel and lists events, and now tries to auto-set-up Pixel + CAPI via GTM / Shopify / Salesforce / WooCommerce. Reported failures, checked 9 Nov 2026:

- Runaway service worker at 70%+ CPU
- Icon won't open
- False "no pixel"
- Setup wizard dead-end (final step asks for a pop-up that never appears)
- Marks broken events "Active" when logged out (5 console errors, 0 panel warnings)
- Misses duplicates, missing value, and misplaced `eventID`
- Asks for debugger + read/change-all-data permissions

PixelScope Pro was built to do the audit properly: real network capture, a real health score, and a fix for every issue — with only `webRequest` + `storage` + `sidePanel` + `scripting` permissions, no login, and nothing sent anywhere.

|  | Meta Pixel Helper | PixelScope Pro |
|---|---|---|
| Detects Pixel ID(s) | Yes | Yes — from all sources, incl. duplicates & silent Pixels |
| Lists events | Yes | Yes — fbq calls **and** real `/tr` network hits |
| Health score 0–100 | No | Yes, with breakdown |
| Deep Audit (data inventory) | No | Yes |
| "Called, never sent" | No | Yes |
| Misplaced `eventID` explained | No | Yes |
| CAPI dedup + payload preview | Partial | Yes |
| Funnel | No | Yes |
| Copy-paste fix per issue | No | Yes |
| Works logged out | Unreliable | Yes |

---

## Install (Chrome / Brave / Edge — 2 minutes)

1. Download the latest release (`pixelscope-v1.7.zip`) and unzip it — you get a folder called `pixelscope` with `manifest.json` inside.
2. Open your browser's extensions page:
   - Chrome: `chrome://extensions`
   - Brave: `brave://extensions`
   - Edge: `edge://extensions`
3. Turn **Developer mode** ON.
4. Click **Load unpacked** and choose the `pixelscope` folder (the folder containing `manifest.json` — not the zip itself).
5. Pin PixelScope, open any site, click the icon — the side panel opens. Reload the page once.

Minimum Chrome version: 116.

## Try it without a real shop

Open `test-page.html` in your browser and click the buttons. It contains a mock `fbq` that fires: a good PageView + ViewContent, a duplicate AddToCart, a Purchase with no value/currency, a Purchase with `eventID` in the wrong place, a second Pixel ID, a `"$49.99"` value, a Lead with a raw email in params, and a lowercase `purchase`. Open the **Deep Audit** tab — it should list 2 Pixel IDs, the full data inventory, and each broken thing as a separate issue.

---

## Privacy

All processing is local, in your browser. PixelScope Pro sends nothing anywhere — no login, no account, no server, no analytics. It only reads what the page you are visiting already sends to Meta, and shows it to you.

Permissions it asks for, and why:
- `webRequest` + host access to all URLs — to capture the real `facebook.com/tr` hits (the only way to get ground truth)
- `storage` — to save your settings and audit history
- `sidePanel` — to open the panel
- `scripting` — to scan the page for Pixels in the main world

## Honest limits

- Browser-only: it cannot see server-side CAPI events, what Meta actually accepted, or Events Manager diagnostics. Always confirm in Events Manager → Test Events.
- It does not auto-install or auto-fix anything on your site — you get the exact fix to paste instead.
- It cannot fix a Pixel that is not installed at all.

## Files

```
manifest.json    Manifest V3, v1.7.0, side panel, webRequest
background.js    Network capture + session storage + page scan + badge
lib.js           Shared parsing + validation (150+ ISO currency list, health score)
content.js       fbq wrapping via injected.js + local analysis
injected.js      Page-world fbq wrapper, /tr watcher, console warnings
panel.html/css/js  Side panel: Events / Pixels / Health / Deep Audit / Funnel / CAPI / Code / Settings
popup.html/css/js  v1.0 popup, kept as a fallback (not the main UI)
test-page.html   Demo page with good + broken Pixels
icons/           Extension icons (16 / 32 / 48 / 128 px)
```

## Version history

- **v1.0** — First build: Health Score, live event timeline, funnel, duplicate/PII/currency checks, multi-platform detection, CAPI tab, install-code generator, audit history, export (report/JSON/CSV).
- **v1.1** — Real network capture, side panel, Settings, shared validation library, page scan, Pixels/Health/Events tabs, "Called, never sent".
- **v1.2** — About credit, Light/Dark/Eye-care themes, 7 bug fixes (incl. GTM Pixels wiped by page scan, double-counted network hits).
- **v1.3** — Meta-like home view, event detail with Setup method / Pixel code / location / Frame / URL called / Load time, emerald theme.
- **v1.4** — Meta theme, copy button on every row, Copy all, ad-blocker checker.
- **v1.5** — Deep recheck: 10 bugs proved and fixed (incl. crash on missing data, false `_fbp` warnings, fbq wrapper stopping after 10s).
- **v1.6** — Meta theme actually works on dark systems; Meta mode hides the other tools, as in Meta's own screenshots.
- **v1.7** — Second deep recheck: 8 bugs proved and fixed (incl. crash on missing issues array, popup crash on `chrome://` pages, History tab never saving, unquoted Pixel IDs missed, sticky tabs, queue replay, settings change affecting all tabs).

## Author

**Mobasher (Md. Mobasherul Hasan)** — WoodMart Developer & WooCommerce Store Designer, co-founder of M1 Shop (free photo tools: https://m1shop.netlify.app)

- Fiverr: https://www.fiverr.com/mobasherul1
- LinkedIn: https://bd.linkedin.com/in/mobasherul1
- Facebook: https://www.facebook.com/Mobasherul0
- GitHub: https://github.com/mobasherul1

Made by — Mobasher, Lab-C, November 2026.
