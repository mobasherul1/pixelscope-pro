// PixelScope Pro v1.1 — background service worker
// MERGED from Pixel Lens (uploaded by Md.): real network capture via
// webRequest + session storage + MAIN-world page scan. Kept from v1.0:
// event-driven only (no polling/timers), health score, CAPI dedup logic.
// What webRequest adds: ground truth. fbq() tells you what the page
// *called*; facebook.com/tr tells you what Meta *actually received* —
// including POST hits, HTTP status, blocked requests, _fbp/_fbc and eid.
import { FILTERS, META_HIT, META_SDK, META_CFG, TRACKERS, parseHit, makeEvent, validate, summarize, pageChecks, healthScore } from './lib.js';

const DEF = { theme: 'auto', preserveLog: false, badge: 'events', showAuto: true };
const MAX_EVENTS = 500;
const blank = (url = '') => ({ events: [], fbqEvents: [], pixels: {}, sdkLoads: 0, trackers: {}, page: null, url, navId: 0, adblock: { detected: false, reason: '' }, blockedByExtension: false });
const getSettings = async () => ({ ...DEF, ...((await chrome.storage.local.get('settings')).settings || {}) });
const load = async id => (await chrome.storage.session.get('t' + id))['t' + id] || blank();
const save = (id, s) => chrome.storage.session.set({ ['t' + id]: s });

// One queue per tab so async load/save cycles never interleave (Lens idea).
const queues = new Map();
function mutate(tabId, fn) {
  const p = (queues.get(tabId) || Promise.resolve()).then(async () => {
    const [s, set] = await Promise.all([load(tabId), getSettings()]);
    fn(s, set);
    await save(tabId, s);
    paintBadge(tabId, s, set);
    chrome.runtime.sendMessage({ type: 'update', tabId }).catch(() => {});
  }).catch(e => console.error('PixelScope', e));
  queues.set(tabId, p);
  return p;
}

function paintBadge(tabId, s, set) {
  const all = [...s.events, ...s.fbqEvents];
  const evs = all.filter(e => set.showAuto || !e.auto);
  const sum = summarize(evs);
  const n = set.badge === 'issues' ? sum.error + sum.warn : evs.length;
  const color = sum.error ? '#c5221f' : sum.warn ? '#a85f00' : evs.length ? '#17803d' : '#5d6b79';
  chrome.action.setBadgeText({ tabId, text: n ? (n > 999 ? '999+' : String(n)) : '' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
  chrome.action.setTitle({ tabId, title: `PixelScope: ${evs.length} event(s), ${sum.error} error(s), ${sum.warn} warning(s)` }).catch(() => {});
}

// New page load → reset, unless "Keep events across page loads" is on (Lens setting, vital for checkout/redirect flows).
chrome.webRequest.onBeforeRequest.addListener(d => {
  if (d.tabId < 0) return;
  mutate(d.tabId, (s, set) => {
    if (set.preserveLog) { s.navId++; s.url = d.url; s.sdkLoads = 0; s.page = null; }
    else Object.assign(s, blank(d.url));
  });
}, { urls: ['<all_urls>'], types: ['main_frame'] });

chrome.webRequest.onBeforeRequest.addListener(d => {
  if (d.tabId < 0) return;
  const url = d.url;
  if (META_HIT.test(url)) {
    const p = parseHit(d); // parses GET query + POST formData / raw body — Lens's parseHit
    mutate(d.tabId, s => {
      const ev = makeEvent(d, p);
      ev.source = 'network'; ev.nav = s.navId;
      ev.issues = validate(ev, s.events.slice(-20));
      s.events.push(ev);
      if (s.events.length > MAX_EVENTS) s.events.shift();
      const px = (s.pixels[ev.pixelId] = s.pixels[ev.pixelId] || { id: ev.pixelId, first: ev.t, count: 0 });
      px.count++; px.last = ev.t; px.sdk = ev.sdk || px.sdk;
    });
  } else if (META_SDK.test(url)) {
    mutate(d.tabId, s => { s.sdkLoads++; });
  } else if (META_CFG.test(url)) {
    const id = url.match(META_CFG)[1];
    mutate(d.tabId, s => { s.pixels[id] = s.pixels[id] || { id, first: Date.now(), count: 0 }; });
  } else {
    const t = TRACKERS.find(([, re]) => re.test(url));
    if (t) mutate(d.tabId, s => { s.trackers[t[0]] = (s.trackers[t[0]] || 0) + 1; });
  }
}, { urls: FILTERS }, ['requestBody']);

function patch(d, fields) {
  if (d.tabId < 0 || !META_HIT.test(d.url)) return;
  mutate(d.tabId, s => {
    // v1.4: a request blocked by an extension is itself the signal — record it
    // even if no event was captured for this requestId yet.
    if (fields.error && /BLOCKED_BY/i.test(fields.error)) s.blockedByExtension = true;
    const i = s.events.findIndex(e => e.rid === d.requestId);
    if (i < 0) return;
    const ev = Object.assign(s.events[i], fields);
    ev.issues = validate(ev, s.events.slice(Math.max(0, i - 20), i));
  });
}
chrome.webRequest.onCompleted.addListener(d => patch(d, { status: d.statusCode }), { urls: FILTERS });
chrome.webRequest.onErrorOccurred.addListener(d => patch(d, { error: d.error }), { urls: FILTERS });

// Runs inside the page (MAIN world) to read what the Pixel itself knows.
// Lens's pageScan, plus noscript IDs and _fbp/_fbc cookies.
function pageScan() {
  const o = { fbq: typeof window.fbq === 'function', version: null, ids: [], codeIds: [], cookies: { fbp: false, fbc: false }, noscriptIds: [], libs: [] };
  try { if (o.fbq) { o.version = window.fbq.version || null; const by = window.fbq.instance && window.fbq.instance.pixelsByID; if (by) o.ids = Object.keys(by); } } catch (e) {}
  try { const ck = document.cookie; o.cookies.fbp = /(^|;\s*)_fbp=/.test(ck); o.cookies.fbc = /(^|;\s*)_fbc=/.test(ck); } catch (e) {}
  const ids = new Set();
  for (const s of document.scripts) {
    if (s.src) continue;
    const t = s.textContent || '';
    if (t.length < 200000 && t.includes('fbq')) for (const m of t.matchAll(/fbq\(\s*['"]init['"]\s*,\s*['"]?(\d{8,20})/g)) ids.add(m[1]);
  }
  o.codeIds = [...ids];
  const ns = new Set();
  document.querySelectorAll('noscript').forEach(n => { const m = (n.textContent || '').match(/facebook\.com\/tr\?id=(\d{8,20})/); if (m) ns.add(m[1]); });
  o.noscriptIds = [...ns];
  const w = window;
  if (w.google_tag_manager) o.gtm = Object.keys(w.google_tag_manager).filter(k => /^GTM-/.test(k));
  if (w.ttq) o.libs.push('TikTok Pixel'); if (w.pintrk) o.libs.push('Pinterest Tag');
  if (w.snaptr) o.libs.push('Snap Pixel'); if (w._linkedin_data_partner_ids) o.libs.push('LinkedIn Insight');
  o.https = location.protocol === 'https:';
  // Meta-style Event info: pixel load time + setup method + pixel location.
  try {
    const entries = (performance.getEntriesByType('resource') || []).filter(e => /fbevents\.js/.test(e.name));
    o.loadMs = entries.length ? Number(entries[entries.length - 1].duration.toFixed(2)) : null;
  } catch (e) { o.loadMs = null; }
  try {
    const html = document.documentElement.outerHTML || '';
    if (w.google_tag_manager) o.setupMethod = 'Google Tag Manager';
    else if (/woocommerce/i.test(html)) o.setupMethod = 'WooCommerce plugin';
    else if (/myshopify\.com|Shopify/i.test(html)) o.setupMethod = 'Shopify app';
    else o.setupMethod = 'Manual';
    o.pixelLocation = o.codeIds.length ? 'In page code' : o.gtm ? 'Google Tag Manager' : o.noscriptIds.length ? 'Noscript fallback' : 'Pixel config';
  } catch (e) { o.setupMethod = 'Manual'; o.pixelLocation = 'Unknown'; }
  return o;
}
async function scan(tabId) {
  let res;
  try { const [r] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: pageScan }); res = (r && r.result) || null; }
  catch (e) { res = { error: String(e.message || e) }; }
  await mutate(tabId, s => { s.page = res; });
  return res;
}

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  (async () => {
    if (m.type === 'getState') {
      const s = await load(m.tabId);
      // FIX v1.5: pageChecks must see merged (network + fbq) events, not
      // network only — otherwise fbq-only pages got a false "no events" warn.
      const merged = [...s.events, ...s.fbqEvents];
      const mergedState = { ...s, events: merged };
      reply({ ...s, health: { score: healthScore(merged, pageChecks(mergedState)), label: '' }, checks: pageChecks(mergedState) });
    }
    else if (m.type === 'scan') reply(await scan(m.tabId));
    else if (m.type === 'clear') { await mutate(m.tabId, s => { s.events = []; s.fbqEvents = []; s.pixels = {}; s.trackers = {}; }); reply(true); }
    // fbq calls from content.js / injected.js — kept, because the test page
    // and fbq-only sites send no real network hit. Merged in the panel:
    // a fbq event with a matching network hit = "sent ✓", without one = "called, never sent".
    else if (m.type === 'PIXELSCOPE_STATE' && sender.tab?.id != null) {
      const st = m.state || {};
      await mutate(sender.tab.id, s => {
        // v1.4: carry the content script's adblock check into the panel state.
        if (st.adblock?.detected) s.adblock = st.adblock;
        if (st.blocked) s.blockedByExtension = true;
        (st.events || []).forEach(e => {
          if (e.kind !== 'fbq_event') return;
          // BUG FIX v1.2: fbq events used to be attributed to the first Pixel only.
          // Now use the Pixel IDs active at call time (from injected.js), falling back to the first known Pixel.
          const ev = { id: 'fbq-' + e.at + '-' + Math.random().toString(36).slice(2, 7), t: e.at, name: e.data.event, pixelId: (e.data.pixelIds?.[0] || st.pixels?.[0]?.id || ''), cd: e.data.params || {}, ud: {}, eventId: e.data.options?.eventID || '', url: st.url || '', source: 'fbq', auto: false, issues: [] };
          // Run the same lib.js validation on fbq calls as on network hits,
          // so the health score is honest even on fbq-only / test pages.
          ev.issues = validate(ev, s.fbqEvents.slice(-20));
          // misplaced eventID — v1.0 check Lens cannot do (network never sees it as eid)
          if (e.data.params?.eventID) ev.issues.push({ level: 'error', msg: 'eventID is inside the params object', fix: 'Move it out: fbq("track", "Purchase", { value, currency }, { eventID: "order-123" })' });
          if (!s.fbqEvents.some(x => x.name === ev.name && Math.abs(x.t - ev.t) < 500 && JSON.stringify(x.cd) === JSON.stringify(ev.cd))) s.fbqEvents.push(ev);
        });
        if (s.fbqEvents.length > MAX_EVENTS) s.fbqEvents = s.fbqEvents.slice(-MAX_EVENTS);
      });
      reply({ ok: true });
    }
    // FIX v1.5: removed the PIXELSCOPE_GET_STATE branch here. That message is
    // sent with chrome.tabs.sendMessage, so only the content script should
    // answer it — the background's session state has a different shape
    // (events / fbqEvents / pixels-as-object, no health/funnel), and the
    // popup would have shown an empty/broken panel from it.
  })();
  return true;
});

chrome.storage.onChanged.addListener(async (c, area) => {
  // FIX v1.7 (proved): on EVERY settings change (e.g. picking a theme) this
  // mutated ALL tabs — saving each session state and firing an 'update' to
  // the panel for every open tab. Badge settings only need a repaint.
  if (area === 'local' && c.settings) for (const t of await chrome.tabs.query({})) {
    const s = await load(t.id), set = await getSettings();
    paintBadge(t.id, s, set);
  }
});
chrome.tabs.onRemoved.addListener(id => { chrome.storage.session.remove('t' + id); queues.delete(id); });
chrome.runtime.onInstalled.addListener(() => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }));
