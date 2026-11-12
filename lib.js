// Shared parsing + validation rules for Pixel Lens.
export const STANDARD = ['PageView','ViewContent','Search','AddToCart','AddToWishlist','InitiateCheckout','AddPaymentInfo','Purchase','Lead','CompleteRegistration','Contact','CustomizeProduct','Donate','FindLocation','Schedule','StartTrial','SubmitApplication','Subscribe'];
export const AUTO = ['SubscribedButtonClick', 'Microdata'];
const CATALOG = ['ViewContent', 'AddToCart', 'InitiateCheckout', 'AddToWishlist', 'Purchase'];
const CONVERSIONS = ['Purchase', 'Lead', 'CompleteRegistration', 'AddToCart', 'InitiateCheckout', 'Subscribe', 'StartTrial'];

export const META_HIT = /^https?:\/\/[\w.-]*facebook\.com\/tr\/?(\?|$)/;
export const META_SDK = /^https?:\/\/connect\.facebook\.net\/[^/]+\/fbevents(\.dev)?\.js/;
export const META_CFG = /connect\.facebook\.net\/signals\/config\/(\d+)/;
export const FILTERS = ['*://*.facebook.com/tr*','*://connect.facebook.net/*','*://www.googletagmanager.com/*','*://*.google-analytics.com/*','*://analytics.google.com/*','*://analytics.tiktok.com/*','*://ct.pinterest.com/*','*://tr.snapchat.com/*','*://px.ads.linkedin.com/*','*://snap.licdn.com/*'];
export const TRACKERS = [
  ['Google Tag Manager', /googletagmanager\.com\/gtm\.js/],
  ['Google tag (gtag.js)', /googletagmanager\.com\/gtag\/js/],
  ['Google Analytics', /(google-analytics\.com|analytics\.google\.com)\/(g\/)?collect/],
  ['TikTok Pixel', /analytics\.tiktok\.com\/api\/v2\/pixel|analytics\.tiktok\.com\/i18n\/pixel/],
  ['Pinterest Tag', /ct\.pinterest\.com\//],
  ['Snap Pixel', /tr\.snapchat\.com\//],
  ['LinkedIn Insight', /(px\.ads\.linkedin\.com|snap\.licdn\.com)\//]
];

export function parseHit(d) {
  const raw = {};
  new URL(d.url).searchParams.forEach((v, k) => { raw[k] = v; });
  const rb = d.requestBody;
  if (rb && rb.formData) for (const k in rb.formData) raw[k] = rb.formData[k][0];
  else if (rb && rb.raw && rb.raw[0] && rb.raw[0].bytes) {
    try { new URLSearchParams(new TextDecoder().decode(rb.raw[0].bytes)).forEach((v, k) => { raw[k] = v; }); } catch (e) {}
  }
  const cd = {}, ud = {};
  for (const [k, v] of Object.entries(raw)) {
    let m;
    if ((m = k.match(/^cd\[(.+)\]$/))) cd[m[1]] = v;
    else if ((m = k.match(/^ud\[(.+)\]$/))) ud[m[1]] = v;
    else if ((m = k.match(/^udff\[(.+)\]$/))) ud[m[1] + ' (form)'] = v;
  }
  return { raw, cd, ud };
}

export function makeEvent(d, p) {
  const r = p.raw, name = r.ev || '';
  return { id: d.requestId, rid: d.requestId, t: Date.now(), method: d.method, pixelId: r.id || '', name,
    auto: r.es === 'automatic' || AUTO.includes(name), eventId: r.eid || '', url: r.dl || '', ref: r.rl || '',
    cd: p.cd, ud: p.ud, fbp: r.fbp || '', fbc: r.fbc || '', sdk: r.v || '', iframe: r.if === 'true',
    trUrl: d.url || '', frame: 'Window',
    status: null, error: null, issues: [] };
}

const I = (level, msg, fix) => ({ level, msg, fix });
const isJSON = (s, test) => { try { return test(JSON.parse(s)); } catch (e) { return false; } };

export function validate(ev, prior = []) {
  // FIX v1.5 (proved): validate() crashed when ev.cd was undefined
  // ("Cannot read properties of undefined (reading 'value')").
  const out = [], cd = ev.cd || {}, n = ev.name;
  // FIX v1.5: fbq events carry no Pixel ID in some flows (GTM) — a missing
  // ID on an fbq call is "unknown", not an error. Network hits must have one.
  if (ev.pixelId && !/^\d{8,20}$/.test(ev.pixelId)) out.push(I('error', 'Pixel ID is missing or not numeric.', 'Check the ID passed to fbq("init", …).'));
  else if (!ev.pixelId && ev.source !== 'fbq') out.push(I('error', 'Pixel ID is missing or not numeric.', 'Check the ID passed to fbq("init", …).'));
  if (!n) out.push(I('error', 'Event has no name.', 'Call fbq("track", "EventName").'));
  const std = STANDARD.find(s => s.toLowerCase() === n.toLowerCase());
  if (std && std !== n) out.push(I('error', `"${n}" is not recognised as a standard event.`, `Event names are case-sensitive. Use "${std}".`));
  else if (n && !std && !ev.auto) out.push(I('info', `"${n}" is a custom event.`, 'Custom events can’t be used for standard optimization. Use it with custom conversions.'));
  if (ev.error) out.push(I('error', `Request failed (${ev.error.replace('net::', '')}).`, 'An ad blocker, privacy extension or network rule is likely blocking facebook.com/tr.'));
  if (ev.status >= 400) out.push(I('error', `Meta responded with HTTP ${ev.status}.`, 'Check the Pixel ID and that the Pixel isn’t disabled or restricted.'));

  const hasVal = cd.value !== undefined && cd.value !== '';
  if (n === 'Purchase') {
    if (!hasVal) out.push(I('error', 'Purchase is missing value.', 'Pass { value: 29.99, currency: "USD" }.'));
    if (!cd.currency) out.push(I('error', 'Purchase is missing currency.', 'Add a 3-letter ISO 4217 code such as USD.'));
  } else if (['AddToCart', 'InitiateCheckout', 'ViewContent'].includes(n) && !hasVal) {
    out.push(I('info', `${n} has no value.`, 'Add value and currency to enable value-based optimization.'));
  }
  if (hasVal) {
    if (!/^-?\d+(\.\d+)?$/.test(cd.value)) out.push(I('error', `value "${cd.value}" is not a plain number.`, 'Send 29.99, not "$29.99" or "29,99".'));
    else if (+cd.value < 0) out.push(I('error', 'value is negative.', 'Use a positive number.'));
    else if (+cd.value === 0 && n === 'Purchase') out.push(I('warn', 'Purchase value is 0.', 'Zero-value purchases can’t be used for ROAS optimization.'));
    if (!cd.currency && n !== 'Purchase') out.push(I('warn', 'value is sent without currency.', 'Add currency: "USD" (or your currency).'));
  }
  if (cd.currency && !/^[A-Z]{3}$/.test(cd.currency)) out.push(I('warn', `currency "${cd.currency}" doesn’t look like an ISO code.`, 'Use uppercase 3-letter codes: USD, EUR, BDT…'));
  else if (cd.currency && !VALID_CURRENCIES.has(cd.currency.toUpperCase())) out.push(I('error', `currency "${cd.currency}" is not a real ISO currency code.`, 'Use a real code from the ISO 4217 list, e.g. USD, BDT, EUR, NGN.'));

  if (CATALOG.includes(n)) {
    if (!cd.content_ids && !cd.contents) out.push(I('warn', `${n} has no content_ids or contents.`, 'Product IDs are required to match events to your catalog for dynamic ads.'));
    else {
      if (!cd.content_type) out.push(I('info', 'content_type is not set.', 'Use "product" or "product_group" to match your catalog.'));
      if (cd.content_ids && !isJSON(cd.content_ids, Array.isArray)) out.push(I('warn', 'content_ids is not a valid array.', 'Pass an array of strings: ["SKU-1","SKU-2"].'));
      if (cd.contents && !isJSON(cd.contents, a => Array.isArray(a) && a.every(x => x && x.id !== undefined))) out.push(I('warn', 'contents is malformed or has items without id.', 'Use [{ id: "SKU-1", quantity: 1 }].'));
    }
  }
  for (const [k, v] of Object.entries(cd)) {
    if (/[^\s@"]+@[^\s@"]+\.[^\s@"]+/.test(v) || (/phone|mobile|tel/i.test(k) && /\d{7,}/.test(v)))
      out.push(I('warn', `Possible personal data in "${k}".`, 'Don’t send raw emails or phone numbers as custom data. Use advanced matching, which hashes them.'));
  }
  if (CONVERSIONS.includes(n) && !ev.eventId) out.push(I('info', 'No event_id on a conversion event.', 'If you also send it via Conversions API, add the same eventID in both so Meta can deduplicate.'));
  if (['Purchase', 'Lead', 'CompleteRegistration'].includes(n) && !Object.keys(ev.ud).length) out.push(I('info', 'No customer information attached.', 'Advanced matching (hashed email/phone) improves match quality.'));
  // FIX v1.5 (proved): every fbq event got a false "No _fbp" warning, because
  // fbq calls never carry _fbp — only real /tr network hits do. Only check it
  // on network events.
  if (!ev.fbp && !ev.iframe && n && ev.source !== 'fbq') out.push(I('warn', 'No _fbp browser ID was sent.', 'First-party cookies may be blocked or disabled; attribution accuracy drops.'));
  if (/^http:\/\/(?!localhost)/.test(ev.url)) out.push(I('warn', 'Page is served over HTTP.', 'Use HTTPS so browsers don’t restrict tracking and cookies.'));
  if (!ev.auto && prior.some(p => p.pixelId === ev.pixelId && p.name === n && p.eventId === ev.eventId && p.url === ev.url && ev.t - p.t < 3000 && JSON.stringify(p.cd) === JSON.stringify(ev.cd)))
    out.push(I('warn', 'Duplicate event within 3 seconds.', 'The same event fires twice. Look for the Pixel installed twice, or both GTM and hard-coded.'));
  return out;
}

const RANK = { error: 3, warn: 2, info: 1 };
export const worst = issues => issues.reduce((w, i) => (RANK[i.level] > RANK[w] ? i.level : w), 'none');
export function summarize(events) {
  // FIX v1.7 (proved): crashed "e.issues is not iterable" if an event had
  // no issues array. healthScore() already guarded this; summarize() didn't.
  const s = { error: 0, warn: 0, info: 0 };
  for (const e of events) for (const i of (e.issues || [])) s[i.level]++;
  return s;
}


// --- PixelScope additions (from v1.0) ---
// Full ISO list (150+ codes). Lens only checked the 3-letter format, so
// BDT/NGN/EGP/PKR etc. passed format but were never checked against a real list.
export const VALID_CURRENCIES = new Set(['AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN', 'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BRL', 'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CAD', 'CDF', 'CHF', 'CLP', 'CNY', 'COP', 'CRC', 'CUC', 'CUP', 'CVE', 'CZK', 'DJF', 'DKK', 'DOP', 'DZD', 'EGP', 'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD', 'GNF', 'GTQ', 'GYD', 'HKD', 'HNL', 'HRK', 'HTG', 'HUF', 'IDR', 'ILS', 'IMP', 'INR', 'IQD', 'IRR', 'ISK', 'JEP', 'JMD', 'JOD', 'JPY', 'KES', 'KGS', 'KHR', 'KMF', 'KPW', 'KRW', 'KWD', 'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LYD', 'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU', 'MUR', 'MVR', 'MWK', 'MXN', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD', 'OMR', 'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG', 'QAR', 'RON', 'RSD', 'RUB', 'RWF', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD', 'SHP', 'SLL', 'SOS', 'SRD', 'SSP', 'STN', 'SYP', 'SZL', 'THB', 'TJS', 'TMT', 'TND', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'UGX', 'USD', 'UYU', 'UZS', 'VES', 'VND', 'VUV', 'WST', 'XAF', 'XCD', 'XOF', 'XPF', 'YER', 'ZAR', 'ZMW', 'ZWL']);
export function healthScore(events, checks) {
  let score = 100;
  const errs = events.flatMap(e => e.issues || []).filter(i => i.level === 'error').length;
  const warns = events.flatMap(e => e.issues || []).filter(i => i.level === 'warn').length;
  score -= errs * 15 + warns * 5;
  if (!events.length) score -= 40;
  if ((checks || []).some(c => c.level === 'error')) score -= 10;
  return Math.max(0, Math.min(100, score));
}

export function pageChecks(s) {
  // FIX v1.5 (proved): pageChecks only looked at network events, so on an
  // fbq-only page it wrongly said "Pixel loaded but no events fired yet",
  // and when fbq was present but no ID was known it said "detected (0 IDs)".
  const ev = [...(s.events || []), ...(s.fbqEvents || [])], pg = s.page && !s.page.error ? s.page : null, c = [];
  const add = (level, title, detail = '') => c.push({ level, title, detail });
  const fired = [...new Set(ev.map(e => e.pixelId).filter(Boolean))];
  const known = new Set([...fired, ...((pg && pg.ids) || []), ...((pg && pg.codeIds) || []), ...Object.keys(s.pixels).filter(Boolean)]);
  if (!known.size && !(pg && pg.fbq) && !s.sdkLoads) add('error', 'No Meta Pixel detected', 'Reload the page with PixelScope open. If you expect a Pixel here, check that its base code runs and no ad blocker is active.');
  else if (!known.size) add('warn', 'Meta Pixel loaded, but no Pixel ID found', 'fbq is present, but no Pixel ID could be read from init, config or code. Check GTM / plugin settings for a missing ID.');
  else add('ok', `Meta Pixel detected (${known.size} ID${known.size === 1 ? '' : 's'})`, [...known].join(', '));
  if (s.sdkLoads > 1) add('warn', `Pixel script loaded ${s.sdkLoads} times`, 'The base code is probably installed twice (theme + GTM or app).');
  else if (s.sdkLoads === 1) add('ok', 'Pixel script loaded once');
  if (known.size && !ev.length) add('warn', 'Pixel loaded but no events fired yet', 'Interact with the page or reload it. Consent banners can delay firing.');
  for (const id of fired) if (!ev.some(e => e.pixelId === id && e.name === 'PageView')) add('warn', `No PageView from ${id}`, 'Standard setups fire PageView on every page load.');
  const idle = [...known].filter(id => !fired.includes(id));
  if (ev.length && idle.length) add('info', `Initialized but silent: ${idle.join(', ')}`, 'Found in the page code or config but no events were sent from it.');
  const blocked = ev.filter(e => e.error).length;
  if (blocked) add('error', `${blocked} request${blocked > 1 ? 's' : ''} blocked or failed`, 'Disable ad blockers or privacy extensions on this site and retest.');
  if (pg) {
    add(pg.cookies.fbp ? 'ok' : 'warn', pg.cookies.fbp ? '_fbp cookie present' : '_fbp cookie missing', pg.cookies.fbp ? '' : 'The Pixel couldn’t set its first-party cookie. Check consent settings and cookie blocking.');
    add(pg.https ? 'ok' : 'warn', pg.https ? 'Page uses HTTPS' : 'Page is not HTTPS');
    if (pg.fbq && pg.version) add('info', `fbevents.js version ${pg.version}`);
  }
  const noId = ev.filter(e => ['Purchase', 'Lead', 'CompleteRegistration'].includes(e.name) && !e.eventId).length;
  if (noId) add('info', `${noId} conversion event${noId > 1 ? 's' : ''} without event_id`, 'Required for clean deduplication if you use Conversions API.');
  return c;
}
