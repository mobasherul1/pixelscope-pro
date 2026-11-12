// PixelScope Pro — popup
let STATE = null, TAB = null;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const time = t => new Date(t).toLocaleTimeString();

async function load() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  TAB = tab;
  if (!tab?.id || /^chrome/.test(tab.url)) { document.querySelector('main').innerHTML = '<div class="empty">Open a real website first — PixelScope cannot run on chrome:// pages.<br><br>Try it on your shop, or on the included test page.</div>'; return; }
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'PIXELSCOPE_GET_STATE' });
    STATE = res?.state || null;
  } catch { STATE = null; }
  if (!STATE) { document.querySelector('main').innerHTML = '<div class="empty">PixelScope is still loading on this page.<br>Reload the page, then open PixelScope again.<br><br><span class="muted">If it still shows nothing, the page may have blocked the extension — check chrome://extensions.</span></div>'; return; }
  render();
  // FIX v1.7 (proved): History was read here but NEVER written anywhere, so
  // the History tab always said "No history". Now save this visit (last 20/domain).
  const { pixelscope_history: h = {} } = await chrome.storage.local.get('pixelscope_history');
  const list = h[STATE.domain] || [];
  list.push({ score: STATE.health?.score ?? 0, at: Date.now(), url: STATE.url, pixels: (STATE.pixels || []).map(p => p.id), events: (STATE.events || []).length, errors: (STATE.issues || []).filter(i => i.severity === 'error').length });
  h[STATE.domain] = list.slice(-20);
  await chrome.storage.local.set({ pixelscope_history: h });
  renderHistory(h[STATE.domain] || []);
}
function render() {
  const s = STATE;
  // FIX v1.7 (proved): next line used s.health.score without ?. — if health
  // was ever missing the popup crashed, even though the line above guarded it.
  const score = s.health?.score ?? 0;
  $('#scoreNum').textContent = s.health?.score ?? '–';
  $('#scoreNum').style.color = score >= 80 ? '#16a34a' : score >= 50 ? '#d97706' : '#dc2626';
  $('#scoreLabel').textContent = s.health?.label || '';
  $('#scoreWhy').textContent = (s.health?.breakdown || []).join(' · ') || 'No deductions';
  $('#issueCount').textContent = s.issues?.length ? `(${s.issues.length})` : '';
  $('#pauseBtn').textContent = s.paused ? '▶ Resume' : '⏸ Pause';
  $('#pixelLine').innerHTML = s.pixels?.length
    ? s.pixels.map(p => `Pixel <b>${esc(p.id)}</b> — ${p.occurrences > 1 ? `<b>${p.occurrences}× in code</b>` : '1×'} · ${p.loaded ? 'loaded' : 'in code only'}`).join('<br>')
    : (s.hasFbScript ? 'Facebook script found, <b>no Pixel ID</b> — init never ran.' : 'No Meta Pixel on this page.');
  const plats = Object.entries(s.platforms || {}).filter(([, v]) => v).map(([k]) => k);
  $('#platformLine').innerHTML = plats.length ? plats.map(p => `<span class="chip">${esc(p)}</span>`).join('') + (s.consent !== 'unknown' ? `<span class="chip warn">consent: ${esc(s.consent)}</span>` : '') + (s.blocked ? `<span class="chip warn">⚠ pixel blocked by ad-blocker</span>` : '') : '<span class="muted">Platform not detected (not WordPress / Shopify / GTM).</span>';
  $('#otherLine').innerHTML = s.otherPixels?.length ? 'Also on this page: ' + s.otherPixels.map(p => `<span class="chip">${esc(p.name)}</span>`).join('') : '';
  renderEvents(); renderIssues(); renderFunnel(); renderCapi(); renderCode();
}
function renderEvents() {
  const q = ($('#filter').value || '').toLowerCase();
  const evs = (STATE.events || []).filter(e => !q || JSON.stringify(e).toLowerCase().includes(q)).slice(-30).reverse();
  $('#eventList').innerHTML = evs.length ? evs.map(e => {
    const name = e.data.event || e.data.pixelId || e.kind;
    return `<div class="ev"><b>${esc(name)}</b> <span class="muted">${esc(e.kind)}</span><span class="time">${time(e.at)}</span><pre>${esc(JSON.stringify(e.data.params || e.data, null, 2)).slice(0, 600)}</pre></div>`;
  }).join('') : '<div class="empty">No events yet on this visit.<br>Reload the page, or click a Test-fire button below.</div>';
}
function renderIssues() {
  $('#issueList').innerHTML = STATE.issues?.length ? STATE.issues.map(i => `<div class="issue ${i.severity}"><b>${esc(i.title)}</b><div>${esc(i.detail)}</div>${i.fix ? `<code>Fix: ${esc(i.fix)}</code>` : ''}</div>`).join('') : '<div class="empty">✓ No issues found on this page.<br><span class="muted">That means the browser events look clean — still confirm in Events Manager, which sees server events too.</span></div>';
}
function renderFunnel() {
  const F = ["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "Purchase"];
  $('#funnelList').innerHTML = F.map(step => `<div class="funnel-step ${STATE.funnel?.[step] ? 'done' : ''}"><span>${step}</span><b>${STATE.funnel?.[step] ? '✓ fired' : '— not yet'}</b></div>`).join('');
}
function renderCapi() {
  const purchases = (STATE.events || []).filter(e => ['Purchase', 'Lead'].includes(e.data.event));
  const withId = purchases.filter(e => e.data.options?.eventID || e.data.options?.event_id);
  const misplaced = purchases.filter(e => e.data.params?.eventID);
  $('#capiList').innerHTML = `
    <div class="ev">Purchase / Lead events seen in browser: <b>${purchases.length}</b><br>With a usable event_id (4th fbq argument): <b>${withId.length}</b><br>${misplaced.length ? `<span style="color:#dc2626">⚠ ${misplaced.length} have eventID <i>inside</i> params — Meta will not deduplicate these.</span>` : 'No misplaced eventID found.'}</div>
    <p class="muted">EMQ estimate: ${emq()} / 10 — based on what the browser sent (value, currency, content_ids, advanced matching). Server data can raise it; this is a floor, not a promise.</p>`;
}
function emq() {
  let n = 3; const evs = STATE.events || [];
  if (evs.some(e => e.data.params?.value && e.data.params?.currency)) n += 2;
  if (evs.some(e => e.data.params?.content_ids)) n += 2;
  if (evs.some(e => e.data.params?.em || e.data.params?.ph)) n += 2;
  if (STATE.issues?.some(i => i.severity === 'error')) n -= 2;
  return Math.max(0, Math.min(10, n));
}
function renderCode() {
  const id = $('#pixelIdInput').value || STATE.pixels?.[0]?.id || 'YOUR_PIXEL_ID';
  $('#codeOut').textContent = `<!-- Meta Pixel Code -->\n<script>\n!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');\nfbq('init', '${id}');\nfbq('track', 'PageView');\n</script>`;
  const p = STATE.platforms || {};
  $('#platformHint').textContent = p.woocommerce ? 'Detected WooCommerce: use ONE plugin (e.g. Meta for WooCommerce) and remove any hard-coded pixel from your theme.' : p.shopify ? 'Detected Shopify: use the Facebook & Instagram app and remove any hard-coded pixel.' : p.gtm ? 'Detected GTM: install the Pixel as a tag in GTM and remove any hard-coded pixel.' : 'No platform detected — paste the code above in <head>.';
}
function renderHistory(list) {
  $('#historyList').innerHTML = list.length ? list.map(h => `<div class="ev"><b>Health ${h.score}/100</b> <span class="time">${new Date(h.at).toLocaleString()}</span><br><span class="muted">${esc(h.url || '')}</span><br>${h.pixels?.length ? 'Pixels: ' + h.pixels.map(esc).join(', ') : 'No pixel'} · ${h.events} events · ${h.errors} errors</div>`).join('') : '<div class="empty">No history for this domain yet.</div>';
}
function download(name, text, type = 'text/plain') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
function reportText() {
  // FIX v1.7: reportText assumed STATE/health/pixels/issues/events all exist.
  // Guarded so the Report button can't crash on a half-loaded state.
  const s = STATE || {};
  return `PixelScope Pro — Audit report\n${s.url || ''}\nChecked: ${new Date().toLocaleString()}\nHealth: ${s.health?.score ?? '?'}/100 (${s.health?.label || ''})\nPixels: ${(s.pixels || []).map(p => p.id).join(', ') || 'none'}\n\nISSUES (${(s.issues || []).length})\n` + (s.issues || []).map(i => `- [${i.severity}] ${i.title}\n  ${i.detail}\n  Fix: ${i.fix || '—'}`).join('\n') + `\n\nEVENTS (${(s.events || []).length})\n` + (s.events || []).map(e => `- ${time(e.at)} ${e.data?.event || e.kind} ${JSON.stringify(e.data?.params || e.data || {})}`).join('\n') + `\n\nNote: browser-only check. Confirm delivery in Events Manager → Test Events. CAPI / server events are not visible here.`;
}
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-tab]'); if (t) { document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b === t)); document.querySelectorAll('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + t.dataset.tab)); return; }
  const f = e.target.closest('[data-fire]'); if (f && TAB) { await chrome.tabs.sendMessage(TAB.id, { type: 'PIXELSCOPE_FIRE_TEST', event: f.dataset.fire, params: f.dataset.fire === 'Purchase' ? { value: 49.99, currency: 'USD', content_ids: ['TEST-123'] } : f.dataset.fire === 'AddToCart' ? { value: 49.99, currency: 'USD', content_ids: ['TEST-123'] } : {} }); setTimeout(load, 600); }
});
$('#filter')?.addEventListener('input', renderEvents);
$('#pixelIdInput')?.addEventListener('input', renderCode);
// FIX v1.7 (proved): these buttons live in the header/footer, outside <main>,
// so they stay clickable even when load() early-returns on chrome:// pages
// with STATE = null — clicking Pause then crashed on `!STATE.paused`, and
// Report/JSON/CSV crashed in reportText(). All now guard on STATE first.
$('#pauseBtn').addEventListener('click', async () => { if (!STATE || !TAB) return; await chrome.tabs.sendMessage(TAB.id, { type: 'PIXELSCOPE_PAUSE', paused: !STATE.paused }); setTimeout(load, 300); });
$('#clearBtn').addEventListener('click', async () => { if (!STATE || !TAB) return; await chrome.tabs.sendMessage(TAB.id, { type: 'PIXELSCOPE_CLEAR' }); setTimeout(load, 300); });
$('#exportBtn').addEventListener('click', () => { if (!STATE) return; download(`pixelscope-audit-${STATE.domain}.txt`, reportText()); });
$('#exportJson').addEventListener('click', () => { if (!STATE) return; download(`pixelscope-${STATE.domain}.json`, JSON.stringify(STATE, null, 2), 'application/json'); });
$('#exportCsv').addEventListener('click', () => { if (!STATE) return; const rows = [['time', 'event', 'params'], ...(STATE.events || []).map(e => [new Date(e.at).toISOString(), e.data?.event || e.kind, JSON.stringify(e.data?.params || {})])]; download(`pixelscope-${STATE.domain}.csv`, rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv'); });
$('#copyCode').addEventListener('click', async () => { await navigator.clipboard.writeText($('#codeOut').textContent); $('#copyCode').textContent = 'Copied ✓'; setTimeout(() => $('#copyCode').textContent = 'Copy base Pixel code', 1500); });
$('#copyCapi').addEventListener('click', async () => { const id = $('#capiId').value || 'order-12345'; const payload = { event_name: 'Purchase', event_time: Math.floor(Date.now() / 1000), event_id: id, action_source: 'website', event_source_url: STATE.url, user_data: { em: ['<sha256 of lowercase email>'], ph: ['<sha256 of phone>'] }, custom_data: { value: 49.99, currency: 'USD', content_ids: ['SKU-123'], content_type: 'product' } }; await navigator.clipboard.writeText(JSON.stringify(payload, null, 2)); $('#copyCapi').textContent = 'Copied ✓'; setTimeout(() => $('#copyCapi').textContent = 'Copy CAPI payload preview', 1500); });
load();
