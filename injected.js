// PixelScope Pro — injected into the PAGE world (MAIN world)
// Reason: a content script runs in an isolated world and cannot see
// window.fbq. This tiny script runs in the page itself, wraps fbq,
// watches real network calls to facebook.com/tr, and reports back
// with window.postMessage. It sends NOTHING to any server.
(function () {
  if (window.__pixelscopeInjected) return;
  window.__pixelscopeInjected = true;

  const send = (payload) => window.postMessage({ source: 'PIXELSCOPE_PAGE', ...payload }, '*');

  function logEvent(kind, data) {
    // FIX v1.7: removed dead `key`/`seen` variables (computed, never used).
    // Do not de-duplicate here — duplicates are exactly what we want to SHOW.
    send({ type: 'PIXELSCOPE_EVENT', kind, data, at: Date.now() });
  }

  // 1) Wrap fbq() — capture init / track / trackCustom / consent calls
  function wrapFbq() {
    const fbq = window.fbq;
    if (!fbq || fbq.__pixelscopeWrapped) return false;
    const orig = fbq;
    const wrapped = function (...args) {
      try {
        const [cmd, name, params] = args;
        if (cmd === 'init') logEvent('fbq_init', { pixelId: String(name), version: window.fbq?.version || null });
        else if (cmd === 'track' || cmd === 'trackCustom') logEvent('fbq_event', { event: name, params: params || {}, options: args[3] || {}, pixelIds: window.fbq?.instance?.pixelsByID ? Object.keys(window.fbq.instance.pixelsByID) : [], standard: cmd === 'track' });
        else if (cmd === 'consent') logEvent('fbq_consent', { action: name, params: params || {} });
        else logEvent('fbq_other', { cmd, name, params: params || {} });
      } catch {}
      return orig.apply(this, args);
    };
    wrapped.__pixelscopeWrapped = true;
    // copy fbq properties (version, queue, etc.)
    Object.keys(orig).forEach(k => { try { wrapped[k] = orig[k]; } catch {} });
    wrapped.version = orig.version;
    wrapped.queue = orig.queue;
    window.fbq = wrapped;
    // FIX v1.7: the queue was replayed on EVERY re-wrap. If fbevents.js
    // replaced fbq after our first wrap, the same queued calls would be
    // logged a second time. Replay once per page, ever.
    if (replayed) return true;
    replayed = true;
    // replay anything already queued before we wrapped
    (orig.queue || []).forEach(args => {
      try {
        const [cmd, name, params] = args;
        if (cmd === 'init') logEvent('fbq_init', { pixelId: String(name) });
        else if (cmd === 'track' || cmd === 'trackCustom') logEvent('fbq_event', { event: name, params: params || {}, options: args[3] || {}, pixelIds: [], standard: cmd === 'track' });
      } catch {}
    });
    return true;
  }

  // 2) Watch real network hits to facebook.com/tr — this is what Meta actually receives
  function watchNetwork() {
    if (window.__pixelscopeNetWatched) return;
    window.__pixelscopeNetWatched = true;
    const parseTr = (url) => {
      try {
        const u = new URL(url, location.href);
        if (!u.hostname.includes('facebook.com') || !u.pathname.includes('/tr')) return;
        const p = Object.fromEntries(u.searchParams.entries());
        if (p.ev) logEvent('network_tr', { event: p.ev, pixelId: p.id, params: p, url: u.href.slice(0, 400) });
      } catch {}
    };
    const of = window.fetch;
    if (of) window.fetch = function (...a) { try { parseTr(String(a[0]?.url || a[0])); } catch {} return of.apply(this, a); };
    const oxo = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function (m, url) { try { parseTr(String(url)); } catch {} return oxo.apply(this, arguments); };
    // <img> beacons: fbq also sends via new Image()
    const OrigImage = window.Image;
    window.Image = function (...a) {
      const img = new OrigImage(...a);
      const d = Object.getOwnPropertyDescriptor(window.HTMLImageElement.prototype, 'src');
      if (d && d.set) Object.defineProperty(img, 'src', { set(v) { try { parseTr(String(v)); } catch {} d.set.call(this, v); }, get() { return d.get.call(this); }, configurable: true });
      return img;
    };
    // FIX v1.5: the old line `window.Image.prototype = OrigImage.prototype`
    // was removed — it is redundant (instances already inherit it) and
    // assigning a built-in's prototype is risky / can throw on some browsers.
  }

  // 3) Capture [Meta Pixel] console warnings — the original hides these when logged out
  const origWarn = console.warn, origError = console.error;
  function hookConsole(fn) {
    return function (...a) {
      try {
        const text = a.map(x => String(x)).join(' ');
        if (text.includes('[Meta Pixel]')) logEvent('console_pixel', { text: text.slice(0, 500) });
      } catch {}
      return fn.apply(this, a);
    };
  }
  console.warn = hookConsole(origWarn);
  console.error = hookConsole(origError);

  watchNetwork();
  let replayed = false;
  // FIX v1.5 (proved): the old timer stopped after 10s, so GTM / delayed
  // Pixels loading after 10s were never wrapped, and if the real fbevents.js
  // replaced window.fbq after we wrapped it, the wrapper was lost silently.
  // Now: check for 30s, and keep re-wrapping if fbq is replaced.
  let tries = 0, readySent = false;
  const timer = setInterval(() => {
    tries++;
    const wrapped = wrapFbq();
    if (wrapped && !readySent) { readySent = true; send({ type: 'PIXELSCOPE_READY', fbqPresent: true, fbqVersion: window.fbq?.version || null }); }
    if (tries >= 60) { // 60 x 500ms = 30s max, then stop — still bounded
      clearInterval(timer);
      if (!readySent) send({ type: 'PIXELSCOPE_READY', fbqPresent: !!window.fbq, fbqVersion: window.fbq?.version || null });
    }
  }, 500);
  wrapFbq();

  // Test-fire from the popup: window.postMessage({source:'PIXELSCOPE_CMD', cmd:'fire', event:'PageView'})
  window.addEventListener('message', (e) => {
    if (e.data?.source !== 'PIXELSCOPE_CMD') return;
    if (e.data.cmd === 'fire' && window.fbq) {
      try { window.fbq('track', e.data.event || 'PageView', e.data.params || {}); send({ type: 'PIXELSCOPE_TEST_FIRED', event: e.data.event }); } catch (err) { send({ type: 'PIXELSCOPE_TEST_FAILED', error: String(err) }); }
    }
  });
})();
