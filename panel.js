// PixelScope Pro v1.1 — side panel
// Base: Pixel Lens panel.js (search/filter, Pixels tab, Health tab, Settings,
// QA report, per-event copy) + PixelScope v1.0 (health score, funnel, CAPI,
// code generator, test-fire, history). Side panel stays open while you
// browse — a popup closes the moment you click the page, which is why
// Lens's side-panel choice wins for checkout walk-throughs.
import { STANDARD, pageChecks, summarize, worst, healthScore } from './lib.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DEF = { theme: 'auto', preserveLog: false, badge: 'events', showAuto: true };
let tabId = null, tabUrl = '', S = null, settings = { ...DEF }, view = 'events', filter = 'all', q = '', lastCount = -1, timers = {};
const open = new Set();
const send = async m => { try { return await chrome.runtime.sendMessage(m); } catch (e) { return null; } };
const later = (k, fn, ms) => { clearTimeout(timers[k]); timers[k] = setTimeout(fn, ms); };
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); later('toast', () => t.classList.remove('on'), 1600); }
async function copy(text, msg = 'Copied') { try { await navigator.clipboard.writeText(text); toast(msg); } catch (e) { toast('Copy failed'); } }
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href); }

async function syncTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!t) return;
  tabId = t.id; tabUrl = t.url || ''; S = null; lastCount = -1; render();
  await refresh(); await send({ type: 'scan', tabId });
}
async function refresh() {
  if (tabId == null) return;
  S = await send({ type: 'getState', tabId });
  if (S && (S.events.length + (S.fbqEvents || []).length) !== lastCount) { lastCount = S.events.length + (S.fbqEvents || []).length; later('scan', () => send({ type: 'scan', tabId }), 800); }
  if (view !== 'settings') render();
}
const host = () => { try { return new URL(tabUrl).host; } catch (e) { return ''; } };
const path = u => { try { return new URL(u).pathname || '/'; } catch (e) { return u || ''; } };
const fmt = t => { const d = new Date(t); return d.toLocaleTimeString([], { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0'); };

// Unified events: network hits are ground truth; fbq calls with no matching
// network hit within 3s are "called, never sent" — e.g. blocked, consent-held, or a mock/test fbq.
function unified() {
  const net = (S.events || []).map(e => ({ ...e, source: 'network' }));
  const fbq = (S.fbqEvents || []).map(e => {
    // BUG FIX v1.2: matching used JSON.stringify(cd), but network cd values
    // are strings ("49.99", '["SKU-1"]') while fbq cd values are numbers/arrays,
    // so nothing ever matched and every event showed "called, never sent".
    // Match on name + Pixel + time only (within 3s).
    const sent = net.some(n => n.name === e.name && (!e.pixelId || !n.pixelId || n.pixelId === e.pixelId) && Math.abs(n.t - e.t) < 3000);
    return { ...e, sent, source: sent ? 'network+fbq' : 'fbq-only' };
  });
  const merged = [...net];
  fbq.forEach(e => { if (!e.sent) merged.push(e); });
  return merged.sort((a, b) => a.t - b.t);
}
function render() {
  // FIX v1.7: measure the real header/tabs heights so the sticky tabs and
  // toolbar sit exactly below them (header height changes when pills wrap).
  const hdr = document.querySelector('header'), tabs = $('#tabs');
  if (hdr) document.documentElement.style.setProperty('--header-h', hdr.offsetHeight + 'px');
  if (tabs) document.documentElement.style.setProperty('--tabs-h', tabs.offsetHeight + 'px');
  $('#host').textContent = host() || 'PixelScope Pro';
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.view === view));
  $('#toolbar').hidden = view !== 'events';
  const m = $('#main'), top = m.scrollTop;
  if (!S) { m.innerHTML = '<p class="empty">Loading…</p>'; return; }
  const all = unified();
  const sum = summarize(all);
  // v1.4 adblocker notice — yellow banner, shown whenever a blocker is detected
  // (bait element, fbq blocked, or a network hit blocked by an extension).
  const ad = S.adblock || {};
  const blockedHit = all.some(e => /BLOCKED_BY/i.test(e.error || ''));
  const showAdblock = !!(ad.detected || S.blockedByExtension || blockedHit);
  const banner = $('#adblockBanner');
  if (banner) { banner.hidden = !showAdblock; if (showAdblock) banner.textContent = `⚠️ An extension or adblocker is running, kindly turn off this — ${ad.reason || 'it may be blocking the Meta Pixel on this page.'}`; }
  $('#summary').innerHTML = `<span class="pill ${all.length ? 'ok' : ''}">${all.length} event${all.length === 1 ? '' : 's'}</span>` +
    (sum.error ? `<span class="pill error">${sum.error} error${sum.error > 1 ? 's' : ''}</span>` : '') +
    (sum.warn ? `<span class="pill warn">${sum.warn} warning${sum.warn > 1 ? 's' : ''}</span>` : '');
  const score = S.health?.score ?? healthScore(all, S.checks || []);
  $('#scoreNum').textContent = score;
  $('#scoreNum').style.color = score >= 80 ? '#17803d' : score >= 50 ? '#a85f00' : '#c5221f';
  $('#scoreLabel').textContent = score >= 80 ? 'Healthy' : score >= 50 ? 'Needs work' : 'Broken';
  $('#scoreWhy').textContent = `${sum.error} errors · ${sum.warn} warnings · ${all.filter(e => e.source === 'fbq-only').length} called, never sent`;
  m.innerHTML = { events: vEvents, pixels: vPixels, page: vHealth, audit: vAudit, funnel: vFunnel, capi: vCapi, code: vCode, settings: vSettings }[view]();
  m.scrollTop = top;
}
const visible = () => unified().filter(e => {
  if (!settings.showAuto && e.auto) return false;
  const lv = worst(e.issues || []);
  if (filter === 'issues' && lv !== 'error' && lv !== 'warn') return false;
  if (filter === 'standard' && !STANDARD.includes(e.name)) return false;
  if (filter === 'custom' && (STANDARD.includes(e.name) || e.auto)) return false;
  if (filter === 'auto' && !e.auto) return false;
  if (filter === 'unsent' && e.source !== 'fbq-only') return false;
  if (q && !(e.name + ' ' + e.pixelId + ' ' + e.url + ' ' + e.eventId + ' ' + JSON.stringify(e.cd)).toLowerCase().includes(q)) return false;
  return true;
}).reverse();
const table = o => { const rows = Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => { const val = typeof v === 'object' ? JSON.stringify(v) : String(v); return `<tr><th>${esc(k)}</th><td>${esc(val)}<button class="copy-mini" data-act="copy" data-text="${esc(k + ': ' + val)}" title="Copy ${esc(k)}">📋</button></td></tr>`; }).join(''); return rows ? `<table>${rows}</table>` : ''; };
let showAllEvents = false;
function pixelIds() {
  const pg = S.page && !S.page.error ? S.page : {};
  return [...new Set([...Object.keys(S.pixels), ...(pg.ids || []), ...(pg.codeIds || []), ...(pg.noscriptIds || [])].filter(Boolean))];
}
function loadTimeText() {
  const ms = S.page?.loadMs;
  return ms == null ? '—' : `${ms} ms`;
}
function evCard(e) {
  // Meta-like event row: name, page URL (truncated), chevron, status dot.
  // Expanded: "Event info" rows exactly like Meta — Setup method, Pixel code,
  // Pixel location, Frame, URL called, Load time — then Parameters, Details, Issues.
  const lv = worst(e.issues || []), nIss = (e.issues || []).filter(i => i.level !== 'info').length;
  const std = STANDARD.includes(e.name);
  const status = e.auto ? 'Automatically detected' : e.source === 'fbq-only' ? 'Called, never sent' : 'Active';
  const dotCls = e.auto ? 'auto' : lv === 'error' ? 'err' : lv === 'warn' ? 'warn' : '';
  const setup = S.page?.setupMethod || 'Manual';
  const location = S.page?.pixelLocation || 'In page code';
  const trUrl = e.trUrl || (e.url ? `https://www.facebook.com/tr?id=${e.pixelId}&ev=${encodeURIComponent(e.name || '')}` : '—');
  return `<details class="ev ${lv}" data-id="${esc(e.id)}" ${open.has(e.id) ? 'open' : ''}>
    <summary>
      <div class="ev-head"><div><div class="ev-name">${esc(e.name || '(no name)')}${!std && e.name ? '<span class="ev-tag">custom</span>' : ''}${nIss ? `<span class="ev-tag ${lv}">${nIss} issue${nIss > 1 ? 's' : ''}</span>` : ''}</div>
      <div class="ev-url">${esc(e.url || '')}</div>
      <div class="ev-status"><span class="dot ${dotCls}"></span>${status}${e.status ? ` · HTTP ${e.status}` : ''} · ${fmt(e.t)}</div></div>
      <span class="chev">⌄</span></div>
    </summary>
    <div class="body">
      <div class="info-bar">Event info</div>
      <div class="info-row"><span class="info-ico">⚙️</span><div><b>Setup method</b><span>${esc(setup)}</span></div><button class="copy-mini" data-act="copy" data-text="${esc('Setup method: ' + setup)}" title="Copy setup method">📋</button></div>
      <div class="info-row"><span class="info-ico">&lt;/&gt;</span><div><b>Pixel code</b><details><summary class="show">Show</summary><pre>${esc(pixelCode(e.pixelId || pixelIds()[0] || 'YOUR_PIXEL_ID'))}</pre></details></div><button class="copy-mini" data-act="copy" data-text="${esc(pixelCode(e.pixelId || pixelIds()[0] || 'YOUR_PIXEL_ID'))}" title="Copy pixel code">📋</button></div>
      <div class="info-row"><span class="info-ico">➤</span><div><b>Pixel location</b><details><summary class="show">Show</summary><span>${esc(location)} — ${esc(e.url || '')}</span></details></div><button class="copy-mini" data-act="copy" data-text="${esc('Pixel location: ' + location + ' — ' + (e.url || ''))}" title="Copy pixel location">📋</button></div>
      <div class="info-row"><span class="info-ico">▣</span><div><b>Frame</b><span>${esc(e.frame || 'Window')}</span></div><button class="copy-mini" data-act="copy" data-text="${esc('Frame: ' + (e.frame || 'Window'))}" title="Copy frame">📋</button></div>
      <div class="info-row"><span class="info-ico">▭</span><div><b>URL called</b><details><summary class="show">Show</summary><pre>${esc(trUrl)}</pre></details></div><button class="copy-mini" data-act="copy" data-text="${esc(trUrl)}" title="Copy URL called">📋</button></div>
      <div class="info-row"><span class="info-ico">◷</span><div><b>Load time</b><span>${esc(loadTimeText())}</span></div><button class="copy-mini" data-act="copy" data-text="${esc('Load time: ' + loadTimeText())}" title="Copy load time">📋</button></div>
      ${(e.issues || []).length ? '<h4>Issues and tips</h4>' + e.issues.map(i => `<div class="issue ${i.level}"><b>${esc(i.msg)}</b><span>${esc(i.fix)}</span></div>`).join('') : '<h4>No issues found</h4>'}
      ${Object.keys(e.cd || {}).length ? '<h4>Parameters — what data was collected</h4>' + table(e.cd) : ''}
      ${Object.keys(e.ud || {}).length ? '<h4>Customer information (hashed by the Pixel)</h4>' + table(e.ud) : ''}
      <h4>Details</h4>${table({ 'Event ID': e.eventId, 'Pixel ID': e.pixelId, Page: e.url, Referrer: e.ref, Method: e.method, 'HTTP status': e.status, 'SDK version': e.sdk, _fbp: e.fbp, _fbc: e.fbc })}
      <div class="row"><button data-act="json" data-id="${esc(e.id)}">Copy JSON</button><button data-act="copy-event" data-id="${esc(e.id)}">Copy event</button><button data-act="copy" data-text="${esc(e.pixelId)}">Copy Pixel ID</button></div>
    </div></details>`;
}
function vEvents() {
  const list = visible();
  const all = unified();
  const ids = pixelIds();
  const totalIssues = all.flatMap(e => e.issues || []).filter(i => i.level !== 'info').length;
  // Meta-like top: pixel card, then "Events on this page".
  const pixelCard = ids.length ? `<div class="pixel-card"><div><h3>Meta pixel</h3><div class="pid">ID: ${esc(ids[0])}${ids.length > 1 ? ` (+${ids.length - 1} more)` : ''}</div><div class="ev-status"><span class="dot"></span>Active · ${all.length} event${all.length === 1 ? '' : 's'}</div></div><button class="copy-btn" data-act="copy" data-text="${esc(ids[0])}" title="Copy Pixel ID">📋</button></div>
  <div class="card load-time-card"><div class="info-row" style="border:0;padding:0"><span class="info-ico">◷</span><div><b>Load time</b><span>${esc(loadTimeText())}</span></div></div></div>` : '';
  if (!list.length) {
    if (all.length) return pixelCard + '<p class="empty"><b>Nothing matches</b>Change the search or filter.</p>';
    if (S.page && S.page.error) return '<p class="empty"><b>This page can’t be inspected</b>Browser pages and the Chrome Web Store are off-limits to extensions.</p>';
    return pixelCard + '<p class="empty"><b>No Pixel events yet</b>Reload the page, then click, add to cart or submit a form. Events appear here as they fire, even while this panel is closed.</p>';
  }
  const shown = showAllEvents ? list : list.slice(0, 6);
  const noActions = totalIssues === 0 ? `<div class="no-actions"><div class="big-check">✓</div><b>No available actions</b><p class="muted">Visit <a href="https://business.facebook.com/events_manager2" target="_blank" rel="noopener">Events Manager</a> for performance opportunities</p></div>` : '';
  return pixelCard +
    `<div class="section-title"><span>Events on this page</span><span class="count-pill">${list.length} event${list.length === 1 ? '' : 's'}</span></div>` +
    shown.map(evCard).join('') +
    (list.length > 6 ? `<div style="text-align:right"><a data-act="toggle-all">${showAllEvents ? 'Show fewer events' : 'Show all events'}</a></div>` : '') +
    noActions +
    `<div class="testrow"><span>Test-fire:</span><button data-fire="PageView">PageView</button><button data-fire="ViewContent">ViewContent</button><button data-fire="AddToCart">AddToCart</button><button data-fire="Purchase">Purchase</button></div><p class="muted">Test-fire sends a real fbq event on this page. Network “sent ✓” appears only if it actually reaches facebook.com/tr.</p>`;
}
function vPixels() {
  const pg = S.page && !S.page.error ? S.page : {};
  const ids = new Set([...Object.keys(S.pixels), ...(pg.ids || []), ...(pg.codeIds || []), ...(pg.noscriptIds || [])].filter(Boolean));
  if (!ids.size) return '<p class="empty"><b>No Pixel IDs found</b>Reload the page with the panel open.</p>';
  return [...ids].map(id => {
    const evs = unified().filter(e => e.pixelId === id), lv = worst(evs.flatMap(e => e.issues || []));
    const counts = {}; evs.forEach(e => { counts[e.name] = (counts[e.name] || 0) + 1; });
    const src = [evs.length && 'sending events', (pg.codeIds || []).includes(id) && 'in page code', (pg.ids || []).includes(id) && 'initialized', (pg.noscriptIds || []).includes(id) && 'noscript fallback'].filter(Boolean).join(', ');
    return `<div class="card"><h3 class="mono">${esc(id)} <span class="tag ${lv}">${lv === 'error' ? 'errors' : lv === 'warn' ? 'warnings' : evs.length ? 'healthy' : 'silent'}</span></h3>
      <p>${esc(src || 'Config loaded')}${S.pixels[id] && S.pixels[id].sdk ? ' · SDK ' + esc(S.pixels[id].sdk) : ''}</p>
      <div class="chips">${Object.entries(counts).map(([k, v]) => `<span>${esc(k)} ×${v}</span>`).join('')}</div>
      <div class="row"><button data-act="copy" data-text="${esc(id)}">Copy ID</button><button data-act="link" data-href="https://business.facebook.com/events_manager2/list/pixel/${esc(id)}">Open in Events Manager</button></div></div>`;
  }).join('');
}
function vHealth() {
  const c = S.checks || pageChecks(S), pg = S.page && !S.page.error ? S.page : {};
  const libs = [...new Set([...Object.keys(S.trackers), ...(pg.libs || []), ...((pg.gtm || []).map(g => 'GTM ' + g))])];
  return `<div>${c.map(x => `<div class="check"><span class="dot ${x.level}">${{ ok: '✓', warn: '!', error: '×', info: 'i' }[x.level]}</span><b>${esc(x.title)}</b>${x.detail ? `<p>${esc(x.detail)}</p>` : ''}</div>`).join('')}</div>
    <h4 style="margin:16px 0 4px;color:var(--mute)">Other tags on this page</h4>
    ${libs.length ? `<div class="chips">${libs.map(l => `<span>${esc(l)}</span>`).join('')}</div>` : '<p class="sub" style="color:var(--mute)">None detected.</p>'}
    <div class="row"><button data-act="report">Copy QA report</button></div>`;
}
function vAudit() {
  // MAIN PURPOSE: deep audit — what Pixel ID(s) is on this site, and exactly
  // what data it is collecting. Aggregated across every event, not one event at a time.
  const all = unified();
  const pg = S.page && !S.page.error ? S.page : {};
  const ids = [...new Set([...Object.keys(S.pixels), ...(pg.ids || []), ...(pg.codeIds || []), ...(pg.noscriptIds || [])].filter(Boolean))];
  const paramKeys = {}, udKeys = {}, eventCounts = {};
  let withValue = 0, withCurrency = 0, withContent = 0, withEventId = 0, withPII = 0, withFbp = 0;
  all.forEach(e => {
    eventCounts[e.name] = (eventCounts[e.name] || 0) + 1;
    Object.keys(e.cd || {}).forEach(k => paramKeys[k] = (paramKeys[k] || 0) + 1);
    Object.keys(e.ud || {}).forEach(k => udKeys[k] = (udKeys[k] || 0) + 1);
    if (e.cd?.value != null) withValue++;
    if (e.cd?.currency) withCurrency++;
    if (e.cd?.content_ids || e.cd?.contents) withContent++;
    if (e.eventId) withEventId++;
    if (e.fbp) withFbp++;
    if (Object.values(e.cd || {}).some(v => typeof v === 'string' && /[^\s@"]+@[^\s@"]+\.[^\s@"]+/.test(v))) withPII++;
  });
  const chipList = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span>${esc(k)} ×${v}</span>`).join('') || '<span class="muted">none</span>';
  return `<h3>Deep Audit — this site's Pixel</h3>
  <div class="card"><b>Pixel ID${ids.length === 1 ? '' : 's'} found: ${ids.length ? ids.map(esc).join(', ') : 'none'}</b>
  <p>Sources: ${[(pg.ids || []).length && 'fbq initialized: ' + pg.ids.join(', '), (pg.codeIds || []).length && 'in page code: ' + pg.codeIds.join(', '), (pg.noscriptIds || []).length && 'noscript fallback: ' + pg.noscriptIds.join(', '), Object.keys(S.pixels).length && 'config / network: ' + Object.keys(S.pixels).join(', ')].filter(Boolean).join(' · ') || '—'}</p>
  <p>SDK: ${esc(pg.version || S.pixels[ids[0]]?.sdk || 'unknown')} · Script loaded ${S.sdkLoads || 0}× · HTTPS: ${pg.https ? 'yes' : 'no'} · _fbp cookie: ${pg.cookies?.fbp ? 'present' : 'missing'} · _fbc cookie: ${pg.cookies?.fbc ? 'present' : 'missing'}</p></div>
  <h4>What data is it collecting? (${all.length} events)</h4>
  <div class="card"><b>Event parameters (cd) — sent to Meta on every hit:</b><div class="chips">${chipList(paramKeys)}</div>
  <b>Customer / Advanced Matching data (ud — hashed by the Pixel):</b><div class="chips">${chipList(udKeys)}</div>
  <p>Also sent on each hit: page URL, referrer, _fbp browser ID${all.some(e => e.fbc) ? ', _fbc click ID' : ' (no _fbc on these hits)'}, event_id${withEventId ? '' : ' (missing on most conversion events — see CAPI tab)'}, SDK version, and whether it was an iframe hit.</p></div>
  <h4>Coverage</h4>
  <div class="card">Events with value: ${withValue}/${all.length} · with currency: ${withCurrency}/${all.length} · with product IDs: ${withContent}/${all.length} · with event_id: ${withEventId}/${all.length} · with _fbp: ${withFbp}/${all.length} · with raw PII in params: <b style="color:${withPII ? '#c5221f' : 'inherit'}">${withPII}</b>${withPII ? ' — see Issues, this should be hashed Advanced Matching only' : ''}</div>
  <h4>Events seen</h4><div class="chips">${chipList(eventCounts)}</div>
  <h4>Other trackers on this page</h4><div class="chips">${[...new Set([...Object.keys(S.trackers), ...(pg.libs || [])])].map(l => `<span>${esc(l)}</span>`).join('') || '<span class="muted">None detected.</span>'}</div>
  <div class="row"><button data-act="report">Copy full QA report</button></div>
  <p class="muted">This is everything the Pixel sends from this browser. It does not include server-side (CAPI) data — check the CAPI tab for that gap.</p>`;
}
function vFunnel() {
  const F = ["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "Purchase"];
  const fired = new Set(unified().map(e => e.name));
  return F.map(step => `<div class="funnel-step ${fired.has(step) ? 'done' : ''}"><span>${step}</span><b>${fired.has(step) ? '✓ fired' : '— not yet'}</b></div>`).join('') + '<p class="muted">Funnel is for this visit only. Walk the shop yourself — the side panel stays open while you click, unlike a popup.</p>';
}
function vCapi() {
  const purchases = unified().filter(e => ['Purchase', 'Lead'].includes(e.name));
  const withId = purchases.filter(e => e.eventId);
  const misplaced = (S.fbqEvents || []).filter(e => e.cd?.eventID);
  return `<h3>Conversions API — what the browser <i>cannot</i> see</h3>
  <p class="muted">Network hits prove the browser sent it. They do not prove the server sent it, or that Meta accepted it. Use this to check deduplication:</p>
  <div class="card">Purchase / Lead events seen: <b>${purchases.length}</b><br>With a usable event_id: <b>${withId.length}</b><br>${misplaced.length ? `<span style="color:#c5221f">⚠ ${misplaced.length} have eventID <i>inside</i> params — Meta will not deduplicate these.</span>` : 'No misplaced eventID found.'}</div>
  <label>Order / event ID to test <input id="capiId" value="order-12345"></label>
  <button id="copyCapi">Copy CAPI payload preview</button>
  <p class="muted">Then open <b>Events Manager → Test Events</b> and send the same event_id from your server. Same ID within 48h = counted once. Different IDs = counted twice.</p>`;
}
function pixelCode(id) {
  return `<!-- Meta Pixel Code -->\n<script>\n!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');\nfbq('init', '${id}');\nfbq('track', 'PageView');\n</script>`;
}
function vCode() {
  const id = (S.page?.ids?.[0] || Object.keys(S.pixels)[0] || 'YOUR_PIXEL_ID');
  // BUG FIX v1.2: codeOut used to render empty until the input changed.
  return `<h3>Install code — one place only</h3><p class="muted">Paste in <b>&lt;head&gt;</b> on every page — or install via GTM / WooCommerce / Shopify, <b>not both</b>.</p>
  <label>Pixel ID <input id="pixelIdInput" value="${esc(id)}"></label>
  <button id="copyCode">Copy base Pixel code</button><pre id="codeOut">${esc(pixelCode(id))}</pre>`;
}
function vSettings() {
  const sel = (k, opts) => `<select data-set="${k}">${opts.map(([v, l]) => `<option value="${v}" ${String(settings[k]) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  return `<div class="set"><div>Theme<small>Meta = looks like Meta Pixel Helper</small></div>${sel('theme', [['auto', 'Match system'], ['light', 'Light'], ['dark', 'Dark'], ['eyecare', 'Eye care'], ['meta', 'Meta']])}</div>
    <div class="set"><div>Toolbar badge<small>What the number on the icon counts</small></div>${sel('badge', [['events', 'Events'], ['issues', 'Issues']])}</div>
    <div class="set"><label>Keep events across page loads<small>Useful for checkout and redirect flows</small></label><input type="checkbox" data-set="preserveLog" ${settings.preserveLog ? 'checked' : ''}></div>
    <div class="set"><label>Show automatic events<small>Button clicks and microdata the Pixel collects on its own</small></label><input type="checkbox" data-set="showAuto" ${settings.showAuto ? 'checked' : ''}></div>
    <p class="sub" style="color:var(--mute);margin-top:14px">Everything is processed locally. PixelScope doesn’t log in, send data anywhere, or change what your site sends to Meta. Network capture uses webRequest only to read facebook.com/tr hits on pages you visit.</p>
    <div class="about-card"><b>About</b><p>Made by - Mobasher, Lab-C, November-2026</p><p>PixelScope Pro v1.7 — a deep-audit tool for Meta Pixel: Pixel IDs, what data is collected, and everything related.</p></div>`;
}
function csv(events) {
  // FIX v1.7: e.cd.value crashed if an event ever had no cd. Defensive ?.
  const cols = ['time', 'pixel_id', 'event', 'automatic', 'event_id', 'value', 'currency', 'content_ids', 'page_url', 'http_status', 'source', 'issues'];
  const cell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  return [cols.join(',')].concat(events.map(e => [new Date(e.t).toISOString(), e.pixelId, e.name, e.auto, e.eventId, e.cd?.value, e.cd?.currency, e.cd?.content_ids, e.url, e.status, e.source, (e.issues || []).map(i => i.level + ': ' + i.msg).join(' | ')].map(cell).join(','))).join('\n');
}
function report() {
  const L = { ok: '✅', warn: '⚠️', error: '❌', info: 'ℹ️' };
  const all = unified();
  return `# PixelScope report: ${host()}\n${new Date().toLocaleString()}\nHealth: ${S.health?.score ?? '?'}/100\n\n## Health checks\n` + (S.checks || []).map(c => `- ${L[c.level]} ${c.title}${c.detail ? ' (' + c.detail + ')' : ''}`).join('\n') +
    `\n\n## Events (${all.length})\n| Time | Pixel | Event | Value | Source | Issues |\n|---|---|---|---|---|---|\n` +
    all.map(e => `| ${fmt(e.t)} | ${e.pixelId} | ${e.name} | ${e.cd.value ? e.cd.value + ' ' + (e.cd.currency || '') : ''} | ${e.source} | ${(e.issues || []).filter(i => i.level !== 'info').map(i => i.msg).join('; ')} |`).join('\n');
}
const main = $('#main');
main.addEventListener('toggle', e => { const id = e.target.dataset && e.target.dataset.id; if (id) e.target.open ? open.add(id) : open.delete(id); }, true);
main.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (b) {
    const a = b.dataset.act;
    if (a === 'copy') copy(b.dataset.text);
    else if (a === 'toggle-all') { showAllEvents = !showAllEvents; render(); }
    else if (a === 'link') chrome.tabs.create({ url: b.dataset.href });
    else if (a === 'report') copy(report(), 'QA report copied');
    else if (a === 'json') { const ev = unified().find(x => x.id === b.dataset.id); if (ev) copy(JSON.stringify({ event: ev.name, pixelId: ev.pixelId, eventId: ev.eventId, parameters: ev.cd, customer: ev.ud, page: ev.url, status: ev.status, source: ev.source, issues: ev.issues }, null, 2), 'Event copied'); }
    else if (a === 'copy-event') { const ev = unified().find(x => x.id === b.dataset.id); if (ev) copy(`Event: ${ev.name}\nPixel ID: ${ev.pixelId}\nEvent ID: ${ev.eventId || '—'}\nPage: ${ev.url || '—'}\nMethod: ${ev.method || '—'} · HTTP: ${ev.status ?? '—'} · SDK: ${ev.sdk || '—'}\n_fbp: ${ev.fbp || '—'} · _fbc: ${ev.fbc || '—'}\nParameters: ${JSON.stringify(ev.cd || {})}\nIssues: ${(ev.issues || []).map(i => i.msg).join('; ') || 'none'}`, 'Event copied'); }
    return;
  }
  const f = e.target.closest('[data-fire]'); if (f) { try { await chrome.tabs.sendMessage(tabId, { type: 'PIXELSCOPE_FIRE_TEST', event: f.dataset.fire, params: f.dataset.fire === 'Purchase' ? { value: 49.99, currency: 'USD', content_ids: ['TEST-123'] } : {} }); } catch {} setTimeout(refresh, 600); return; }
  if (e.target.id === 'copyCode') { const id = $('#pixelIdInput').value || 'YOUR_PIXEL_ID'; await copy(pixelCode(id), 'Pixel code copied'); return; }
  if (e.target.id === 'copyCapi') { const id = $('#capiId').value || 'order-12345'; await copy(JSON.stringify({ event_name: 'Purchase', event_time: Math.floor(Date.now() / 1000), event_id: id, action_source: 'website', event_source_url: tabUrl, user_data: { em: ['<sha256 of lowercase email>'] }, custom_data: { value: 49.99, currency: 'USD', content_ids: ['SKU-123'], content_type: 'product' } }, null, 2), 'CAPI payload copied'); return; }
});
main.addEventListener('change', e => { const k = e.target.dataset.set; if (!k) return; settings[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; chrome.storage.local.set({ settings }); applyTheme(); if (k === 'theme') render(); });
main.addEventListener('input', e => { if (e.target.id === 'pixelIdInput') { const id = e.target.value || 'YOUR_PIXEL_ID'; const pre = $('#codeOut'); if (pre) pre.textContent = pixelCode(id); } });
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { view = b.dataset.view; render(); } });
$('#q').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); render(); });
$('#filter').addEventListener('change', e => { filter = e.target.value; render(); });
$('#clear').addEventListener('click', async () => { await send({ type: 'clear', tabId }); open.clear(); toast('Cleared'); });
$('#rescan').addEventListener('click', async () => { await send({ type: 'scan', tabId }); toast('Page rescanned'); });
$('#exp-json').addEventListener('click', () => { if (S) download(`pixelscope-events-${host()}.json`, JSON.stringify(visible().reverse(), null, 2), 'application/json'); });
$('#exp-csv').addEventListener('click', () => { if (S) download(`pixelscope-events-${host()}.csv`, csv(visible().reverse()), 'text/csv'); });
$('#exportBtn').addEventListener('click', () => { if (!S) { toast('Nothing to export yet — reload the page first'); return; } download(`pixelscope-audit-${host()}.txt`, report()); });
async function copyAll() { if (!S) { toast('Nothing to copy yet — reload the page first'); return; } await copy(report(), 'All data copied ✓'); }
$('#copyAllBtn')?.addEventListener('click', copyAll);
$('#copyAllBtn2')?.addEventListener('click', copyAll);
function applyTheme() {
  // 'auto' follows the system; light / dark / eyecare / meta are explicit.
  // Eyecare = warm paper, low blue light, softer contrast.
  // Meta = 100% Meta Pixel Helper look, and in Meta mode only Meta's own
  // tools are shown (see panel.css) — so force the Events home view.
  if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', settings.theme);
  if (settings.theme === 'meta') view = 'events';
  // Keep the top-area icon buttons in sync with the Settings dropdown.
  document.querySelectorAll('[data-theme-btn]').forEach(b => b.classList.toggle('active', b.dataset.themeBtn === settings.theme));
}
document.querySelectorAll('[data-theme-btn]').forEach(b => b.addEventListener('click', async () => {
  settings.theme = b.dataset.themeBtn;
  await chrome.storage.local.set({ settings });
  applyTheme();
  render(); // re-render so Meta mode hides/shows the other tools at once
}));
window.addEventListener('resize', () => { const hdr = document.querySelector('header'), tabs = $('#tabs'); if (hdr) document.documentElement.style.setProperty('--header-h', hdr.offsetHeight + 'px'); if (tabs) document.documentElement.style.setProperty('--tabs-h', tabs.offsetHeight + 'px'); });
chrome.runtime.onMessage.addListener(m => { if (m.type === 'update' && m.tabId === tabId) later('refresh', refresh, 60); });
chrome.tabs.onActivated.addListener(syncTab);
chrome.tabs.onUpdated.addListener((id, info) => { if (id !== tabId) return; if (info.url) tabUrl = info.url; if (info.status === 'complete') later('scan', () => send({ type: 'scan', tabId }), 400); });
(async () => { settings = { ...DEF, ...((await chrome.storage.local.get('settings')).settings || {}) }; applyTheme(); await syncTab(); })();
