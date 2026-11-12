// PixelScope Pro — content script (isolated world)
// Collects: page scan + messages from injected.js, analyses them locally,
// and hands a ready-to-display state to the popup / background.
// Nothing leaves the browser. No login needed — all checks run locally,
// which is exactly what the original fails to do when logged out.

// Full ISO currency list (150+ codes) — the original's built-in list only had 49,
// so NGN, EGP, PKR etc. were wrongly flagged "invalid currency".
const VALID_CURRENCIES = new Set(("AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS IMP INR IQD IRR ISK JEP JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLL SOS SRD SSP STN SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWL").split(" "));
const STANDARD_EVENTS = new Set(["PageView","ViewContent","Search","AddToCart","AddToWishlist","InitiateCheckout","AddPaymentInfo","Purchase","Lead","CompleteRegistration","Contact","CustomizeProduct","Donate","FindLocation","Schedule","StartTrial","SubmitApplication","Subscribe"]);
const FUNNEL = ["PageView","ViewContent","AddToCart","InitiateCheckout","Purchase"];

const state = {
  url: location.href, domain: location.hostname, at: Date.now(),
  pixels: [], events: [], issues: [], consoleWarnings: [],
  platforms: {}, otherPixels: [], consent: 'unknown', blocked: false,
  health: { score: 100, breakdown: [] }, funnel: {}, paused: false,
  loadMs: null, saveHistory: true, adblock: { detected: false, reason: '' },
};

// v1.4 adblocker / extension checker — three signals, checked locally:
// 1) bait element with ad classes — extensions hide it; 2) Pixel script in
// the page but fbq never loads; 3) a fetch to connect.facebook.net fails
// while the browser is online. Any one = show the yellow notice in the panel.
let adblockChecked = false;
function checkAdblock() {
  // FIX v1.5 (proved): checkAdblock() was called on every pushState — a fetch
  // to connect.facebook.net and a bait-element DOM write on every event.
  // Now it runs once per page load.
  if (state.adblock.detected || adblockChecked) return;
  adblockChecked = true;
  try {
    const bait = document.createElement('div');
    bait.className = 'adsbox ad-banner pub_300x250 adsbygoogle';
    bait.style.cssText = 'width:10px;height:10px;position:absolute;left:-9999px;top:0;';
    bait.innerHTML = '&nbsp;';
    (document.body || document.documentElement).appendChild(bait);
    const hidden = bait.offsetParent === null || bait.offsetHeight === 0 || getComputedStyle(bait).display === 'none' || getComputedStyle(bait).visibility === 'hidden';
    bait.remove();
    if (hidden) { state.adblock = { detected: true, reason: 'An ad-blocker hid the test ad element on this page.' }; return; }
  } catch {}
  if (state.hasFbScript && !window.fbq) {
    state.adblock = { detected: true, reason: 'The Pixel script is in the page but fbq never loaded — likely blocked by an extension.' };
    return;
  }
  if (navigator.onLine) {
    fetch('https://connect.facebook.net/en_US/fbevents.js', { mode: 'no-cors', cache: 'no-store' }).catch(() => {
      if (!state.adblock.detected) state.adblock = { detected: true, reason: 'connect.facebook.net could not be reached from this browser — likely blocked by an extension.' };
      debouncePush();
    });
  }
}

let injectedAt = Date.now();
function pushState() {
  if (state.paused) return;
  checkAdblock();
  analyse();
  try { chrome.runtime.sendMessage({ type: 'PIXELSCOPE_STATE', state }); } catch {}
}
function debouncePush() { clearTimeout(pushState._t); pushState._t = setTimeout(pushState, 250); }

// --- page scan: find pixel IDs / platforms in the raw HTML + scripts ---
let lastScanAt = 0;
function scanPage() {
  // FIX v1.5: scanPage() read the whole document outerHTML on every event
  // (debounced pushState). On large pages that is megabytes per event.
  // Now at most once every 5s, unless no Pixel has been found yet.
  const now = Date.now();
  if (now - lastScanAt < 5000 && state.pixels.length) return;
  lastScanAt = now;
  const html = document.documentElement?.outerHTML || '';
  const ids = new Map();
  // FIX v1.7 (proved): this regex required quotes around the ID, so an
  // unquoted init — fbq('init', 1703743156368535) — was missed here while
  // background.js found it. Now allows unquoted, like background.
  const re = /fbq\(\s*['"]init['"]\s*,\s*['"]?(\d{6,20})['"]?/g;
  let m; while ((m = re.exec(html))) ids.set(m[1], (ids.get(m[1]) || 0) + 1);
  // also: connect.facebook.net signals + fbevents.js
  const hasFbScript = /connect\.facebook\.net|fbevents\.js/.test(html);
  // BUG FIX v1.2: scanPage used to rebuild state.pixels from HTML only, wiping
  // Pixels found via fbq (e.g. GTM-loaded Pixels, which are not in the HTML).
  // Now merge: keep already-known Pixels, add code-found ones.
  const known = new Map(state.pixels.map(p => [p.id, p]));
  [...ids.entries()].forEach(([id, count]) => {
    if (known.has(id)) known.get(id).occurrences = Math.max(known.get(id).occurrences || 1, count);
    else known.set(id, { id, source: 'code', occurrences: count, loaded: !!window.fbq });
  });
  state.pixels = [...known.values()];
  state.hasFbScript = hasFbScript;
  state.platforms = {
    wordpress: /wp-content|wp-includes|wordpress/i.test(html),
    woocommerce: /woocommerce/i.test(html),
    shopify: /myshopify\.com|Shopify\.theme|cdn\.shopify/i.test(html),
    gtm: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/.test(html),
    ga4: /gtag\(|googletagmanager\.com\/gtag\/js|G-[A-Z0-9]{6,}/.test(html),
  };
  state.otherPixels = [];
  if (/ttq\(|analytics\.tiktok\.com/i.test(html)) state.otherPixels.push({ name: 'TikTok', status: 'found in code' });
  if (/snaptr\(|sc-static\.net/i.test(html)) state.otherPixels.push({ name: 'Snapchat', status: 'found in code' });
  if (/pintrk\(|ct\.pinterest\.com/i.test(html)) state.otherPixels.push({ name: 'Pinterest', status: 'found in code' });
  if (/gtag\(['"]config['"]\s*,\s*['"]AW-/i.test(html)) state.otherPixels.push({ name: 'Google Ads', status: 'found in code' });
  if (/linkedin|snap\.licdn\.com/i.test(html)) state.otherPixels.push({ name: 'LinkedIn Insight', status: 'found in code' });
  // consent: look for revoke in page text / fbq queue
  if (/fbq\(\s*['"]consent['"]\s*,\s*['"]revoke['"]/i.test(html)) state.consent = 'revoked';
  else if (/fbq\(\s*['"]consent['"]\s*,\s*['"]grant['"]/i.test(html)) state.consent = 'granted';
  // blocked? code present but fbq never loads after 10s = ad-blocker / tracking protection
  state.blocked = hasFbScript && !window.fbq && (Date.now() - injectedAt > 8000);
}

// --- analysis: health score + issues (runs locally, no login) ---
function analyse() {
  scanPage();
  const issues = [];
  const add = (severity, title, detail, fix) => issues.push({ severity, title, detail, fix });
  const evs = state.events;
  const pixelIds = state.pixels.map(p => p.id);

  if (!pixelIds.length && !state.hasFbScript) add('error', 'No Meta Pixel found', 'No fbq init and no Facebook script on this page. Either it is not installed, or it only fires on a click / route change.', 'Copy the install code from the Code tab and paste it in <head> on every page — or install it once via GTM / your WooCommerce / Shopify plugin, not both.');
  if (state.hasFbScript && !pixelIds.length) add('warning', 'Facebook script loaded, but no pixel ID', 'fbevents.js is there but fbq("init", …) never ran. Check GTM / plugin settings for a missing ID.', 'Open GTM or your plugin, paste the Pixel ID from Events Manager, publish, hard-refresh.');
  if (state.blocked) add('error', 'Pixel blocked before it could load', 'The script tag is in the page but fbq never appeared — usually an ad-blocker, Brave Shields, or Firefox Enhanced Tracking Protection on your own browser.', 'Pause your ad-blocker for this domain, or test in a clean Chrome profile with no blocker, then reload.');
  if (state.consent === 'revoked') add('warning', 'Consent revoked — events are held', 'This page called fbq("consent", "revoke"). Events will not send until the visitor accepts the cookie banner.', 'Accept the banner yourself before testing, and check the banner actually calls fbq("consent", "grant").');
  if (pixelIds.length > 1) add('error', `${pixelIds.length} different Pixels on one page`, `IDs: ${pixelIds.join(', ')}. Data is split, audiences are muddled, and reporting will not add up.`, 'Keep one Pixel per site. Remove old agency / app Pixels from the theme, GTM and plugins — leave exactly one.');
  // duplicate init of same ID
  const initCounts = {};
  state.events.filter(e => e.kind === 'fbq_init').forEach(e => initCounts[e.data.pixelId] = (initCounts[e.data.pixelId] || 0) + 1);
  Object.entries(initCounts).forEach(([id, n]) => { if (n > 1) add('error', `Pixel ${id} initialised ${n}×`, 'Same Pixel loaded more than once (theme + plugin, or GTM + hard-coded). Every event can fire twice.', 'Install it in ONE place only. Remove the duplicate from the theme or GTM.'); });

  // per-event checks
  const seenEv = {};
  evs.filter(e => e.kind === 'fbq_event' || e.kind === 'network_tr').forEach(e => {
    const name = e.data.event || e.data.params?.ev; const p = e.data.params || {};
    const evId = e.data.options?.eventID || e.data.options?.event_id || e.data.options?.eid; // correct place: 4th fbq argument
    const key = name + '|' + (evId || JSON.stringify(p));
    seenEv[key] = (seenEv[key] || 0) + 1;
    if (['Purchase','AddToCart','InitiateCheckout'].includes(name)) {
      if (p.value == null || p.value === '' || Number(p.value) === 0) add('error', `${name}: missing or zero value`, 'No value was sent, so Meta cannot optimise for revenue or report ROAS.', 'Send value as a number, e.g. fbq("track", "Purchase", { value: 49.99, currency: "USD" })');
      if (!p.currency) add('error', `${name}: missing currency`, 'value without currency is ignored for value-based bidding.', 'Always send currency with value, e.g. currency: "USD".');
      else if (!VALID_CURRENCIES.has(String(p.currency).toUpperCase())) add('error', `${name}: invalid currency "${p.currency}"`, 'This currency code is not in the ISO currency list.', 'Use a 3-letter ISO code from Meta\'s currency list, e.g. USD, BDT, EUR.');
      if (Number(p.value) < 0) add('error', `${name}: negative value`, 'value must be ≥ 0.', 'Fix the price calculation before sending the event.');
    }
    if (['ViewContent','AddToCart','Purchase'].includes(name) && !p.content_ids && !p.contentIds) add('warning', `${name}: no content_ids`, 'Without product IDs, catalogue ads and dynamic retargeting cannot match this event to a product.', 'Send content_ids: ["SKU-123"] and content_type: "product".');
    if (!evId && ['Purchase','Lead','CompleteRegistration'].includes(name)) add('warning', `${name}: no event_id — CAPI deduplication will fail`, 'Browser + server (CAPI) events need the SAME event_id to deduplicate. Without it Meta counts the purchase twice.', 'Generate one ID per purchase and send it in both: fbq("track", "Purchase", { … }, { eventID: "order-123" }) — note eventID is the 4th argument, NOT inside the params object.');
    if (p.eventID) add('error', `${name}: eventID is inside the params object`, 'fbq sends it as a custom parameter cd[eventID] and Meta never sees it as a real event ID — dedup silently fails.', 'Move it out: fbq("track", "Purchase", { value, currency }, { eventID: "order-123" })');
    // Deep-audit checks from Pixel Lens, applied to fbq calls too
    if (typeof p.value === 'string' && !/^-?\d+(\.\d+)?$/.test(p.value)) add('error', `${name}: value "${p.value}" is not a plain number`, 'Meta expects 29.99, not "$29.99" or "29,99".', 'Send value as a number: { value: 29.99, currency: "USD" }');
    for (const [k, v] of Object.entries(p)) {
      if (typeof v === 'string' && /[^\s@"]+@[^\s@"]+\.[^\s@"]+/.test(v)) add('warning', `Possible personal data in "${k}"`, 'Raw email in event parameters. Use Advanced Matching (hashed) instead — do not send raw PII as custom data.', 'Remove the raw email/phone from params; send it only via Advanced Matching, hashed.');
    }
    if (p.content_ids && typeof p.content_ids === 'string') { try { const a = JSON.parse(p.content_ids); if (!Array.isArray(a)) add('warning', `${name}: content_ids is not an array`, 'Pass an array of strings.', 'content_ids: ["SKU-1", "SKU-2"]'); } catch { add('warning', `${name}: content_ids is not valid JSON`, 'It must be a JSON array string.', 'content_ids: ["SKU-1"]'); } }
    if (name && [...STANDARD_EVENTS].some(s => s.toLowerCase() === String(name).toLowerCase()) && !STANDARD_EVENTS.has(name)) add('error', `"${name}" is not a standard event name — case matters`, 'Meta treats event names as case-sensitive.', 'Use the exact standard name, e.g. "Purchase".');
    if (name && !STANDARD_EVENTS.has(name) && e.kind === 'fbq_event') add('info', `"${name}" is a custom event`, 'Custom events are fine, but they need a Custom Conversion in Events Manager to optimise on.', 'If this is really a Lead / Purchase / etc., use the standard name instead.');
  });
  Object.entries(seenEv).forEach(([k, n]) => { if (n > 1) { const [name] = k.split('|'); add('error', `Duplicate ${name} ×${n}`, 'The same event fired more than once on this page load. Ads Manager will count it more than once.', 'Find the second trigger — usually a plugin + GTM, or a button handler that runs twice — and remove one.'); } });
  // console warnings from the pixel itself
  state.consoleWarnings.forEach(w => add('error', 'Meta Pixel console warning', w.text, 'Fix the parameter named in the warning — it is printed by the pixel itself, even when the panel shows Active.'));
  // funnel
  const fired = new Set(evs.map(e => e.data.event).filter(Boolean));
  state.funnel = Object.fromEntries(FUNNEL.map(s => [s, fired.has(s)]));
  if (fired.has('AddToCart') && !fired.has('InitiateCheckout')) add('info', 'Funnel gap: AddToCart fired, InitiateCheckout did not', 'On this visit no checkout was started — normal if you did not check out, a problem if you did.', 'Walk through checkout yourself and watch for InitiateCheckout.');
  if (fired.has('InitiateCheckout') && !fired.has('Purchase')) add('info', 'Funnel gap: InitiateCheckout fired, Purchase did not', 'Normal if you did not complete the order on this visit.', 'Complete a test order and watch for Purchase with value + currency.');

  // health score: start 100, deduct
  let score = 100; const breakdown = [];
  const deduct = (n, why) => { score -= n; breakdown.push(`-${n} ${why}`); };
  if (!pixelIds.length) deduct(50, 'no pixel');
  if (issues.some(i => i.severity === 'error')) deduct(15 * issues.filter(i => i.severity === 'error').length, 'errors');
  if (issues.some(i => i.severity === 'warning')) deduct(5 * issues.filter(i => i.severity === 'warning').length, 'warnings');
  if (state.blocked) deduct(20, 'pixel blocked');
  if (pixelIds.length > 1) deduct(10, 'multiple pixels');
  score = Math.max(0, Math.min(100, score));
  state.issues = issues;
  state.health = { score, breakdown: breakdown.slice(0, 8), label: score >= 80 ? 'Healthy' : score >= 50 ? 'Needs work' : 'Broken' };
}

// --- wiring: inject page script, listen to it, answer popup ---
function inject() {
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('injected.js');
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
}
window.addEventListener('message', (e) => {
  if (e.data?.source !== 'PIXELSCOPE_PAGE') return;
  if (e.data.type === 'PIXELSCOPE_EVENT') {
    if (state.paused) return;
    // BUG FIX v1.2: network_tr hits were added here as well as fbq_event for
    // the same action, double-counting events and false-flagging missing
    // value (raw /tr params are cd[value], not value). The background already
    // captures real network hits via webRequest — skip them here.
    if (e.data.kind === 'network_tr') return;
    state.events.push({ kind: e.data.kind, data: e.data.data, at: e.data.at });
    if (state.events.length > 200) state.events = state.events.slice(-200);
    if (e.data.kind === 'console_pixel') state.consoleWarnings.push(e.data.data);
    if (e.data.kind === 'fbq_consent') state.consent = e.data.data.action === 'revoke' ? 'revoked' : 'granted';
    if (e.data.kind === 'fbq_init' && !state.pixels.some(p => p.id === String(e.data.data.pixelId))) state.pixels.push({ id: String(e.data.data.pixelId), source: 'fbq', occurrences: 1, loaded: true });
    debouncePush();
  }
  if (e.data.type === 'PIXELSCOPE_READY') { state.loadMs = Date.now() - injectedAt; debouncePush(); }
});

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg?.type === 'PIXELSCOPE_GET_STATE') { analyse(); sendResponse({ state }); return true; }
  if (msg?.type === 'PIXELSCOPE_CLEAR') { state.events = []; state.issues = []; state.consoleWarnings = []; pushState(); sendResponse({ ok: true }); return true; }
  if (msg?.type === 'PIXELSCOPE_PAUSE') { state.paused = !!msg.paused; pushState(); sendResponse({ ok: true }); return true; }
  if (msg?.type === 'PIXELSCOPE_FIRE_TEST') { window.postMessage({ source: 'PIXELSCOPE_CMD', cmd: 'fire', event: msg.event, params: msg.params || {} }, '*'); sendResponse({ ok: true }); return true; }
  return false;
});

inject();
scanPage();
setTimeout(pushState, 1200); // one delayed check for late-loading pixels, then nothing
setTimeout(pushState, 9000); // one more for GTM-delayed pixels, then nothing — no polling
