(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  // search matches only at the start of a word: next index >= from where `term` begins a word in `str`
  const WORDCH = /[\p{L}\p{N}]/u;
  function wordIndex(str, term, from = 0) {
    for (let i = str.indexOf(term, from); i >= 0; i = str.indexOf(term, i + 1))
      if (i === 0 || !WORDCH.test(str[i - 1])) return i;
    return -1;
  }
  const hasWord = (str, term) => wordIndex(str, term) >= 0;
  const countWord = (str, term) => { let n = 0; for (let i = wordIndex(str, term); i >= 0; i = wordIndex(str, term, i + term.length)) n++; return n; };

  // theme toggle
  const root = document.documentElement;
  // appearance: colour scheme + light / dark / auto
  const apBtn = $('[data-appearance]'), apPanel = $('#appearance-panel');
  const store = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  const syncAppearance = () => {
    const sc = root.dataset.scheme || 'tegla', mode = root.dataset.theme || 'auto';
    $$('[data-scheme-set]').forEach(b => b.setAttribute('aria-pressed', b.dataset.schemeSet === sc));
    $$('[data-mode-set]').forEach(b => b.setAttribute('aria-pressed', b.dataset.modeSet === mode));
  };
  $$('[data-scheme-set]').forEach(b => b.addEventListener('click', () => {
    const v = b.dataset.schemeSet;
    if (v === 'tegla') delete root.dataset.scheme; else root.dataset.scheme = v;
    store('scheme', v === 'tegla' ? null : v);
    syncAppearance();
  }));
  $$('[data-mode-set]').forEach(b => b.addEventListener('click', () => {
    const v = b.dataset.modeSet;
    if (v === 'auto') delete root.dataset.theme; else root.dataset.theme = v;
    store('theme', v === 'auto' ? null : v);
    syncAppearance();
  }));
  const setPanel = open => { apPanel.hidden = !open; apBtn.setAttribute('aria-expanded', open); };
  apBtn.addEventListener('click', e => { e.stopPropagation(); setPanel(apPanel.hidden); });
  document.addEventListener('click', e => { if (!apPanel.hidden && !apPanel.contains(e.target)) setPanel(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !apPanel.hidden) { setPanel(false); apBtn.focus(); } });
  syncAppearance();

  // mobile menu
  const nav = $('.main-nav');
  $$('[data-menu-toggle]').forEach(b => b.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    b.setAttribute('aria-expanded', open);
  }));

  // collapse the section tree on small screens
  if (matchMedia('(max-width: 980px)').matches) {
    const box = $('.sidenav-box');
    if (box) box.open = false;
  }

  // document pages: text / PDF view switch
  const panels = $$('[data-view-panel]');
  if (panels.length) {
    const tabs = $$('.view-switch [data-view]');
    const show = v => {
      panels.forEach(p => { p.hidden = p.dataset.viewPanel !== v; });
      tabs.forEach(t => t.setAttribute('aria-selected', t.dataset.view === v));
      try { localStorage.setItem('docView', v); } catch (e) {}
      if (v === 'pdf') initPdf($('.pdf-viewer'));
    };
    tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.view)));
    $$('[data-view-link]').forEach(b => b.addEventListener('click', () => { show(b.dataset.viewLink); scrollTo({ top: 0 }); }));
    let pref = null;
    try { pref = localStorage.getItem('docView'); } catch (e) {}
    if (location.hash === '#pdf') pref = 'pdf';
    if (pref === 'pdf') show('pdf');
  }

  $$('.pdf-viewer[data-autoload]').forEach(v => initPdf(v));

  // PDF viewer (pdf.js, served locally, loaded on first use)
  async function initPdf(el) {
    if (!el || el.dataset.ready) return;
    el.dataset.ready = '1';
    const status = $('.pdf-status', el), wrap = $('.pdf-pages', el);
    // wrap = the viewer's own scroll area; stack = everything inside it (scaled during a pinch preview)
    const stack = document.createElement('div');
    stack.className = 'pdf-stack';
    wrap.append(stack);
    try {
      const pdfjs = await import('/assets/pdfjs/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '/assets/pdfjs/pdf.worker.min.mjs';
      const pdf = await pdfjs.getDocument(el.dataset.pdf).promise;
      const N = pdf.numPages;
      const first = await pdf.getPage(1);
      const base = first.getViewport({ scale: 1 });
      const sizes = new Map([[1, [base.width, base.height]]]);     // page size in PDF units, filled as pages load
      let scale = 1;
      const fitK = Math.min(1000, wrap.clientWidth - 32) / base.width;   // 100%: fits the viewer, at most 1000px
      const k = () => fitK * scale;                                        // CSS px per PDF unit
      const slots = [];

      let preview = null;
      const dockTop = () => $('.site-header').getBoundingClientRect().bottom + 16;
      const render = async slot => {
        const want = k();
        if (slot.renderingAt === want || slot.renderedAt === want) return;
        slot.renderingAt = want;
        const page = await pdf.getPage(slot.n);
        const vp1 = page.getViewport({ scale: 1 });
        if (!sizes.has(slot.n)) { sizes.set(slot.n, [vp1.width, vp1.height]); sizeSlot(slot); }
        const vp = page.getViewport({ scale: want });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const c = document.createElement('canvas');
        c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr);
        c.setAttribute('aria-label', `${slot.n}. oldal`);
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
        if (slot.renderingAt !== want) return;                       // zoomed again meanwhile
        slot.renderingAt = null;
        slot.renderedAt = want;
        const old = $('canvas', slot.el);
        old ? old.replaceWith(c) : slot.el.prepend(c);               // swap in place: no blank flash
        slot.el.classList.add('ready');
      };
      const io = new IntersectionObserver(es => es.forEach(e => {
        if (e.isIntersecting) render(slots[Number(e.target.dataset.n) - 1]);
      }), { root: wrap, rootMargin: '800px 200px' });
      const sizeSlot = s => {
        const [w, h] = sizes.get(s.n) || sizes.get(1);
        s.el.style.width = w * k() + 'px';
        s.el.style.height = h * k() + 'px';
      };
      for (let n = 1; n <= N; n++) {
        const pg = document.createElement('div');
        pg.className = 'pdf-pg';
        pg.dataset.n = n;
        pg.innerHTML = `<span class="pdf-pg-label">${n}. oldal</span><div class="pdf-hl"></div>`;
        stack.append(pg);
        const slot = { n, el: pg, hl: $('.pdf-hl', pg) };
        slots.push(slot);
        sizeSlot(slot);
        io.observe(pg);
      }
      const relayout = () => {
        slots.forEach(s => {
          sizeSlot(s);
          if (s.renderedAt !== k()) s.renderedAt = null;
          io.unobserve(s.el); io.observe(s.el);                     // re-render visible ones at the new scale
        });
        drawMarks();
      };

      // ---- current page in the toolbar
      let curPage = 0;
      const updatePage = () => {
        const r = wrap.getBoundingClientRect(), mid = r.top + r.height / 2;
        let n = 1;
        for (const s of slots) { if (s.el.getBoundingClientRect().top <= mid) n = s.n; else break; }
        if (n !== curPage) { curPage = n; status.textContent = `${n} / ${N} oldal`; }
      };
      let pr = false;
      wrap.addEventListener('scroll', () => { if (!pr) { pr = true; requestAnimationFrame(() => { pr = false; updatePage(); }); } }, { passive: true });

      // Wheel / trackpad over the viewer: each step goes to the page until the toolbar docks under the
      // site header, then to the PDF, and past the PDF's last (first) page back to the page. Applied
      // instantly per event (no native smooth scroll running alongside), so nothing jumps.
      // Outside the viewer the page scrolls natively; touch inside uses the browser's own hand-off.
      const pageMax = () => document.documentElement.scrollHeight - innerHeight;
      wrap.addEventListener('wheel', e => {
        if (e.ctrlKey) return;                                            // pinch / ctrl+wheel zoom
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
        let dy = e.deltaY * unit;
        if (Math.abs(e.deltaX * unit) > Math.abs(dy)) return;            // sideways: native horizontal scroll
        e.preventDefault();
        const d = dockTop(), top = el.getBoundingClientRect().top;
        const pageBy = m => { if (m) window.scrollTo({ top: scrollY + m, behavior: 'instant' }); };
        if (dy > 0) {
          if (top > d) { const m = Math.min(dy, top - d, pageMax() - scrollY); pageBy(m); dy -= m; }
          const m2 = Math.min(dy, wrap.scrollHeight - wrap.clientHeight - wrap.scrollTop);
          wrap.scrollTop += m2; dy -= m2;
          if (dy > 0) pageBy(Math.min(dy, pageMax() - scrollY));
        } else if (dy < 0) {
          if (top < d) { const m = Math.min(-dy, d - top, scrollY); pageBy(-m); dy += m; }
          const m2 = Math.min(-dy, wrap.scrollTop);
          wrap.scrollTop -= m2; dy += m2;
          if (dy < 0) pageBy(Math.max(dy, -scrollY));
        }
      }, { passive: false });

      // ---- zoom, anchored to a point on screen: the same spot of the same page stays under it
      const clampScale = v => Math.max(0.5, Math.min(4, v));
      const anchorAt = (fx, fy) => {
        for (const s of slots) {
          const r = s.el.getBoundingClientRect();
          if (fy <= r.bottom || s.n === N) return { s, px: (fx - r.left) / r.width, py: (fy - r.top) / r.height, fx, fy };
        }
      };
      const zoomTo = (next, fx, fy) => {
        next = clampScale(next);
        if (Math.abs(next - scale) < 0.001) return;
        const a = anchorAt(fx, fy);
        scale = next;
        relayout();
        const r = a.s.el.getBoundingClientRect();
        wrap.scrollLeft += r.left + a.px * r.width - a.fx;
        wrap.scrollTop += r.top + a.py * r.height - a.fy;
        updatePage();
      };
      const viewCentre = () => { const r = wrap.getBoundingClientRect(); return [r.left + r.width / 2, Math.max(r.top, 0) + (Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / 2]; };
      $$('[data-zoom]', el).forEach(b => b.addEventListener('click', () => zoomTo(scale * (b.dataset.zoom > 0 ? 1.25 : 0.8), ...viewCentre())));

      // pinch preview: scale the stack with a transform, commit (re-layout) on release
      const startPreview = (fx, fy) => {
        const r = wrap.getBoundingClientRect();
        preview = { ratio: 1, fx, fy };
        stack.style.transformOrigin = `${fx - r.left + wrap.scrollLeft}px ${fy - r.top + wrap.scrollTop}px`;
      };
      const showPreview = ratio => { preview.ratio = clampScale(scale * ratio) / scale; stack.style.transform = `scale(${preview.ratio})`; };
      const commitPreview = () => {
        if (!preview) return;
        const { ratio, fx, fy } = preview;
        preview = null;
        stack.style.transform = '';
        zoomTo(scale * ratio, fx, fy);
      };
      let pinch0 = 0;
      const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
      wrap.addEventListener('touchstart', e => {
        if (e.touches.length === 2) {
          pinch0 = dist(e.touches);
          startPreview((e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2);
        }
      }, { passive: true });
      wrap.addEventListener('touchmove', e => {
        if (e.touches.length === 2 && preview && pinch0) { e.preventDefault(); showPreview(dist(e.touches) / pinch0); }
      }, { passive: false });
      wrap.addEventListener('touchend', e => { if (preview && e.touches.length < 2) { pinch0 = 0; commitPreview(); } });
      wrap.addEventListener('touchcancel', () => { pinch0 = 0; commitPreview(); });
      // trackpad pinch arrives as ctrl+wheel; keep it from zooming the whole page
      let wheelT, wheelRatio = 1;
      wrap.addEventListener('wheel', e => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        if (!preview) { startPreview(e.clientX, e.clientY); wheelRatio = 1; }
        wheelRatio *= Math.exp(-Math.max(-10, Math.min(10, e.deltaY)) * 0.01);   // mouse wheel notches are ~100, trackpad steps small
        showPreview(wheelRatio);
        clearTimeout(wheelT);
        wheelT = setTimeout(commitPreview, 180);
      }, { passive: false });

      // ---- search inside the PDF
      const tools = $('.pdf-tools', el);
      const sBtn = document.createElement('button');
      sBtn.type = 'button'; sBtn.className = 'icon-btn'; sBtn.setAttribute('aria-label', 'Keresés a dokumentumban');
      sBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      tools.prepend(sBtn);
      const row = document.createElement('div');
      row.className = 'pdf-search'; row.hidden = true;
      row.innerHTML = `<input type="search" placeholder="Keresés a dokumentumban…" aria-label="Keresés a dokumentumban" autocomplete="off">
        <span class="pdf-count" aria-live="polite"></span>
        <button type="button" class="icon-btn" data-step="-1" aria-label="Előző találat">↑</button>
        <button type="button" class="icon-btn" data-step="1" aria-label="Következő találat">↓</button>
        <button type="button" class="icon-btn" data-close aria-label="Keresés bezárása">✕</button>`;
      $('.pdf-toolbar', el).append(row);
      const sInput = $('input', row), sCount = $('.pdf-count', row);
      const fold = str => {
        const f = [...str].map(ch => norm(ch).charAt(0) || ch).join('');
        return f.length === str.length ? f : str.toLowerCase();
      };
      const texts = new Map();
      const pageText = async n => {
        if (texts.has(n)) return texts.get(n);
        const page = await pdf.getPage(n);
        const vp1 = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        let text = '';
        const items = [];
        for (const it of tc.items) {
          if (!it.str) { if (it.hasEOL) text += ' '; continue; }
          const tx = pdfjs.Util.transform(vp1.transform, it.transform);
          items.push({ start: text.length, end: text.length + it.str.length, x: tx[4], y: tx[5],
                       w: it.width, h: Math.hypot(tx[2], tx[3]) || it.height });
          text += fold(it.str);
          if (it.hasEOL) text += ' ';
        }
        const t = { text, items };
        texts.set(n, t);
        return t;
      };
      let matches = [], cur = -1, token = 0;
      const rectsFor = (t, a, b) => t.items.filter(it => it.end > a && it.start < b).map(it => {
        const len = it.end - it.start || 1;
        const x0 = it.x + it.w * (Math.max(a, it.start) - it.start) / len;
        const x1 = it.x + it.w * (Math.min(b, it.end) - it.start) / len;
        return [x0, it.y - it.h * 0.95, Math.max(2, x1 - x0), it.h * 1.2];
      });
      function drawMarks() {
        slots.forEach(s => s.hl.replaceChildren());
        matches.forEach((m, i) => {
          const s = slots[m.n - 1];
          m.els = m.rects.map(([x, y, w, h]) => {
            const d = document.createElement('div');
            d.className = 'pdf-mark' + (i === cur ? ' current' : '');
            Object.assign(d.style, { left: x * k() + 'px', top: y * k() + 'px', width: w * k() + 'px', height: h * k() + 'px' });
            s.hl.append(d);
            return d;
          });
        });
      }
      const go = i => {
        if (!matches.length) return;
        cur = (i + matches.length) % matches.length;
        $$('.pdf-mark.current', el).forEach(d => d.classList.remove('current'));
        matches[cur].els.forEach(d => d.classList.add('current'));
        const d = matches[cur].els[0];
        if (d) {
          const wr = wrap.getBoundingClientRect(), dr = d.getBoundingClientRect();
          wrap.scrollLeft += dr.left - wr.left - wr.width / 2 + dr.width / 2;
          wrap.scrollTop += dr.top - wr.top - wr.height / 2;
          if (Math.abs(el.getBoundingClientRect().top - dockTop()) > 2) el.scrollIntoView({ block: 'start' });
        }
        sCount.textContent = `${cur + 1} / ${matches.length}`;
      };
      const runSearch = async () => {
        const my = ++token;
        const q = fold(sInput.value.trim());
        matches = []; cur = -1;
        if (q.length < 2) { sCount.textContent = ''; drawMarks(); return; }
        sCount.textContent = 'Keresés…';
        for (let n = 1; n <= N; n++) {
          const t = await pageText(n);
          if (my !== token) return;                    // a newer search started
          for (let i = wordIndex(t.text, q); i >= 0; i = wordIndex(t.text, q, i + q.length))
            matches.push({ n, rects: rectsFor(t, i, i + q.length) });
        }
        drawMarks();
        if (matches.length) go(0); else sCount.textContent = 'Nincs találat';
      };
      let st;
      sInput.addEventListener('input', () => { clearTimeout(st); st = setTimeout(runSearch, 250); });
      sInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); go(cur + (e.shiftKey ? -1 : 1)); }
        if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
      });
      const openSearch = () => { row.hidden = false; el.classList.add('searching'); sInput.focus({ preventScroll: true }); sInput.select(); };
      const closeSearch = () => { row.hidden = true; el.classList.remove('searching'); sInput.value = ''; runSearch(); sBtn.focus({ preventScroll: true }); };
      sBtn.addEventListener('click', () => (row.hidden ? openSearch() : closeSearch()));
      $$('[data-step]', row).forEach(b => b.addEventListener('click', () => go(cur + Number(b.dataset.step))));
      $('[data-close]', row).addEventListener('click', closeSearch);
      // the browser's own find can't see text drawn on canvases
      document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && el.offsetParent) { e.preventDefault(); openSearch(); }
      });

      updatePage();
    } catch (e) {
      status.innerHTML = 'A PDF nem jeleníthető meg itt. <a href="' + el.dataset.pdf + '" target="_blank" rel="noopener">Megnyitás új lapon</a>';
      console.error(e);
    }
  }

  // audio: one shared player bar at the bottom of the screen, reused for every recording
  const fmt = s => {
    if (!isFinite(s)) return '–:––';
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  };
  const bar = document.createElement('div');
  bar.className = 'player-bar';
  bar.hidden = true;
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Hanglejátszó');
  bar.innerHTML = `
    <div class="pb-inner">
      <button type="button" class="pb-play" aria-label="Lejátszás">
        <svg class="pb-i-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>
        <svg class="pb-i-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>
      </button>
      <div class="pb-main">
        <div class="pb-top">
          <a class="pb-title" href="#"></a>
          <span class="pb-time"><span class="pb-cur">0:00</span> / <span class="pb-dur">–:––</span></span>
        </div>
        <input class="pb-seek" type="range" min="0" max="1000" value="0" step="1" aria-label="Pozíció">
      </div>
      <div class="pb-ctrls">
        <button type="button" class="pb-skip" data-skip="-15" aria-label="15 mp vissza">−15</button>
        <button type="button" class="pb-skip" data-skip="30" aria-label="30 mp előre">+30</button>
        <button type="button" class="pb-rate" aria-label="Lejátszási sebesség">1×</button>
      </div>
      <button type="button" class="pb-close" aria-label="Lejátszó bezárása">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>
    <audio preload="metadata"></audio>`;
  document.body.append(bar);
  const audio = $('audio', bar), seek = $('.pb-seek', bar), cur = $('.pb-cur', bar), dur = $('.pb-dur', bar);
  const playBtn = $('.pb-play', bar), rateBtn = $('.pb-rate', bar), titleEl = $('.pb-title', bar);
  let current = null;           // {src, title, page}
  let leaving = false;          // set on pagehide: the browser's own pause while unloading must not be saved
  // the open recording's links; on folder pages its row too (is-open, is-playing: style.css draws the icon)
  const markRow = (l, on, playing) => {
    const row = l.closest('.folder-item');
    if (!row) return;
    row.classList.toggle('is-open', on);
    row.classList.toggle('is-playing', playing);
  };
  const markLinks = () => $$('[data-audio]').forEach(l => {
    const on = !!current && l.dataset.audio === current.src;
    l.classList.toggle('audio-current', on);
    l.classList.toggle('audio-playing', on && !audio.paused);
    markRow(l, on, on && !audio.paused);
  });
  const save = () => {
    try {
      if (current) sessionStorage.setItem('player', JSON.stringify({ ...current, t: audio.currentTime, playing: !audio.paused }));
      else sessionStorage.removeItem('player');
    } catch (e) {}
  };
  let onBarChange = () => {};   // the video box moves up while the bar is open
  const showBar = on => {
    bar.hidden = !on;
    document.body.classList.toggle('has-player', on);
    onBarChange();
  };
  const loadTrack = (item, play = true, at = 0) => {
    if (!current || current.src !== item.src) {
      current = item;
      audio.src = item.src;
      titleEl.textContent = item.title;
      titleEl.href = item.page || '#';
      seek.value = 0; cur.textContent = fmt(at); dur.textContent = '–:––';
      if (at) audio.addEventListener('loadedmetadata', () => { audio.currentTime = at; }, { once: true });
    }
    showBar(true);
    if (play) audio.play().catch(() => {});
    markLinks();
  };
  const close = () => {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    current = null;
    showBar(false);
    markLinks();
    save();
  };
  playBtn.addEventListener('click', () => (audio.paused ? audio.play() : audio.pause()));
  $('.pb-close', bar).addEventListener('click', close);
  audio.addEventListener('play', () => { bar.classList.add('playing'); playBtn.setAttribute('aria-label', 'Szünet'); markLinks(); });
  audio.addEventListener('pause', () => { bar.classList.remove('playing'); playBtn.setAttribute('aria-label', 'Lejátszás'); markLinks(); if (!leaving) save(); });
  audio.addEventListener('loadedmetadata', () => { dur.textContent = fmt(audio.duration); });
  audio.addEventListener('timeupdate', () => {
    cur.textContent = fmt(audio.currentTime);
    if (!seek.dragging && audio.duration) seek.value = Math.round(audio.currentTime / audio.duration * 1000);
  });
  audio.addEventListener('ended', () => { audio.currentTime = 0; save(); });
  seek.addEventListener('input', () => { seek.dragging = true; if (audio.duration) cur.textContent = fmt(seek.value / 1000 * audio.duration); });
  seek.addEventListener('change', () => { if (audio.duration) audio.currentTime = seek.value / 1000 * audio.duration; seek.dragging = false; });
  $$('.pb-skip', bar).forEach(b => b.addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime + Number(b.dataset.skip)); }));
  const rates = [1, 1.25, 1.5, 2, 0.75];
  rateBtn.addEventListener('click', () => {
    const r = rates[(rates.indexOf(audio.playbackRate) + 1) % rates.length];
    audio.playbackRate = r;
    rateBtn.textContent = String(r).replace('.', ',') + '×';
  });
  addEventListener('pagehide', () => { save(); leaving = true; });
  addEventListener('pageshow', () => { leaving = false; });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && current && !document.querySelector('dialog[open]') && !document.body.classList.contains('video-big')) close();
  });

  // any element with data-audio (links on content pages, the big button on a recording's page) feeds the bar
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-audio]');
    if (!el || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    if (current && current.src === el.dataset.audio) {
      audio.paused ? audio.play() : audio.pause();
      return;
    }
    const page = el.dataset.audioPage || (el.tagName === 'A' ? el.getAttribute('href') : location.pathname);
    const label = el.dataset.audioLabel || (el.tagName === 'A' ? el.textContent.trim() : '');
    loadTrack({ src: el.dataset.audio, title: label || el.dataset.audioTitle, page });
  });

  // keep the recording across page loads, at the same position; if it was playing, carry on (where the
  // browser's autoplay rules allow it — otherwise it stays paused and one tap resumes)
  const savedState = key => { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (e) { return null; } };
  const restoreAudio = () => {
    const saved = savedState('player');
    if (!saved || !saved.src) { if (current) close(); return; }
    if (current && current.src === saved.src) {
      if (Math.abs(audio.currentTime - (saved.t || 0)) > 1) audio.currentTime = saved.t || 0;
      if (saved.playing) audio.play().catch(() => {}); else if (!audio.paused) audio.pause();
      return;
    }
    loadTrack({ src: saved.src, title: saved.title, page: saved.page }, !!saved.playing, saved.t || 0);
  };
  restoreAudio();
  // back / forward can bring a page back from the browser's page cache as it was left, player and all:
  // catch up with what happened on the other pages (closed there, another recording, a later position)
  addEventListener('pageshow', e => { if (e.persisted) restoreAudio(); });

  // video: a floating box with a YouTube player, opened by links to Drive videos that have a YouTube copy
  // (data-yt, from videos/manifest.tsv). Like the audio bar it follows the reader: video, title, page, time,
  // playing and size are kept in sessionStorage and restored on the next page (it comes back paused where
  // the browser blocks autoplay). The inline .video[data-yt] tiles are separate (see "YouTube facades").
  const vbox = document.createElement('div');
  vbox.className = 'video-box';
  vbox.hidden = true;
  vbox.setAttribute('role', 'region');
  vbox.setAttribute('aria-label', 'Videólejátszó');
  const vIcon = (d, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  vbox.innerHTML = `
    <div class="vb-head">
      <a class="vb-title" href="#"></a>
      <button type="button" class="vb-btn vb-min" aria-label="Összecsukás" title="Összecsukás">${vIcon('M5 12h14')}</button>
      <button type="button" class="vb-btn vb-restore" aria-label="Visszaállítás" title="Visszaállítás">${vIcon('M6 15l6-6 6 6')}</button>
      <button type="button" class="vb-btn vb-big" aria-label="Nagyítás" title="Nagyítás">${vIcon('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', 'vb-i-grow')}${vIcon('M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5', 'vb-i-shrink')}</button>
      <button type="button" class="vb-btn vb-yt" aria-label="Megnyitás a YouTube-on" title="Megnyitás a YouTube-on">${vIcon('M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5')}</button>
      <button type="button" class="vb-btn vb-close" aria-label="Videó bezárása" title="Bezárás">${vIcon('M6 6l12 12M18 6 6 18')}</button>
    </div>
    <div class="vb-body"><div class="vb-frame"></div></div>`;
  document.body.append(vbox);
  const vTitle = $('.vb-title', vbox), vFrame = $('.vb-frame', vbox), bigBtn = $('.vb-big', vbox);
  let vcur = null;              // {id, title, page}
  let vsize = 'normal';         // 'normal' | 'min' | 'big'
  let yt = null, ytReady = false, vplaying = false, vstart = 0, vleaving = false;
  const vtime = () => {         // not started yet (or restored and paused): the start time
    if (!yt || !ytReady) return vstart;
    const t = yt.getCurrentTime() || 0;
    return yt.getPlayerState() === YT.PlayerState.CUED ? vstart : t || vstart;
  };
  const vsave = () => {
    try {
      if (vcur) sessionStorage.setItem('video', JSON.stringify({ ...vcur, t: vtime(), playing: vplaying, size: vsize }));
      else sessionStorage.removeItem('video');
    } catch (e) {}
  };
  const markVideoLinks = () => $$('a[data-yt], button[data-yt]').forEach(l => {
    const on = !!vcur && l.dataset.yt === vcur.id;
    l.classList.toggle('video-current', on);
    l.classList.toggle('video-playing', on && vplaying);
    markRow(l, on, on && vplaying);
  });
  // above the audio bar when that is open; enlarged = the width of the PDF viewer on document pages (the
  // page width, --wrap less its 24px sides), the same on every page, as far as the screen height allows
  const place = () => {
    const below = bar.hidden ? 0 : bar.offsetHeight;
    vbox.style.setProperty('--vb-bottom', below + 'px');
    if (vsize === 'big') {
      const wrap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wrap')) || 1200;
      const head = $('.vb-head', vbox).offsetHeight;
      const w = Math.min(wrap - 48, innerWidth - 48, (innerHeight - below - head - 32) * 16 / 9);
      vbox.style.setProperty('--vb-w', Math.round(w) + 'px');
    }
  };
  onBarChange = place;
  addEventListener('resize', place);
  const setSize = s => {
    vsize = s;
    vbox.classList.toggle('vb-is-min', s === 'min');
    vbox.classList.toggle('vb-is-big', s === 'big');
    document.body.classList.toggle('video-big', s === 'big');
    const label = s === 'big' ? 'Eredeti méret' : 'Nagyítás';
    bigBtn.setAttribute('aria-label', label);
    bigBtn.title = label;
    place();
    vsave();
  };
  let ytApi = null;
  const loadYtApi = () => ytApi || (ytApi = new Promise(resolve => {
    if (window.YT && YT.Player) return resolve();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(); };
    document.head.append(Object.assign(document.createElement('script'), { src: 'https://www.youtube.com/iframe_api' }));
  }));
  let afterPause = null;         // the "open on YouTube" button waits for the pause (see there)
  const onState = e => {
    if (e.data === YT.PlayerState.PAUSED && afterPause) afterPause();
    if (e.data === YT.PlayerState.PLAYING) {
      vplaying = true;
      if (!audio.paused) audio.pause();
    } else if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED || e.data === YT.PlayerState.CUED) {
      vplaying = false;
    }
    markVideoLinks();
    if (!vleaving) vsave();
  };
  // fresh: a new player even if one is ready (stopping by replacing the player does not depend on the
  // embed obeying a pause command)
  const openVideo = (item, { play = true, at = 0, size = 'normal', fresh = false } = {}) => {
    vcur = item;
    vstart = at;
    vplaying = false;
    vTitle.textContent = item.title;
    vTitle.title = item.title;
    vTitle.href = item.page || '#';
    vbox.hidden = false;
    document.body.classList.add('has-video');
    setSize(size);
    markVideoLinks();
    loadYtApi().then(() => {
      if (!vcur || vcur.id !== item.id) return;
      if (yt && ytReady && !fresh) {
        yt[play ? 'loadVideoById' : 'cueVideoById']({ videoId: item.id, startSeconds: at });
        return;
      }
      if (yt) yt.destroy();
      const el = document.createElement('div');
      vFrame.replaceChildren(el);
      ytReady = false;
      yt = new YT.Player(el, {
        host: 'https://www.youtube-nocookie.com',
        videoId: item.id,
        playerVars: { autoplay: play ? 1 : 0, start: Math.floor(at), rel: 0, playsinline: 1, enablejsapi: 1, origin: location.origin },
        events: { onReady: () => { ytReady = true; if (play) yt.playVideo(); }, onStateChange: onState },
      });
    });
  };
  const closeVideo = () => {
    if (yt) { try { yt.destroy(); } catch (e) {} }
    yt = null; ytReady = false; vcur = null; vplaying = false;
    vFrame.replaceChildren();
    vbox.hidden = true;
    document.body.classList.remove('has-video');
    setSize('normal');            // also saves: the stored video is removed
    markVideoLinks();
  };
  $('.vb-min', vbox).addEventListener('click', () => setSize('min'));
  $('.vb-restore', vbox).addEventListener('click', () => setSize('normal'));
  bigBtn.addEventListener('click', () => setSize(vsize === 'big' ? 'normal' : 'big'));
  $('.vb-close', vbox).addEventListener('click', closeVideo);
  // pause first, open the tab once the player reports the pause: a pause sent as the new tab comes to the
  // front is not carried out while this page is in the background (the audio bar's pause, sent while the
  // page is visible, works). No confirmation within 0.6 s: open anyway and swap in a paused player at the
  // same time, which stops it for certain. (Opening the tab that soon after the click is still allowed.)
  $('.vb-yt', vbox).addEventListener('click', () => {
    if (!vcur) return;
    const t = Math.floor(vtime());
    const open = () => window.open(`https://www.youtube.com/watch?v=${vcur.id}&t=${t}s`, '_blank', 'noopener');
    if (!vplaying || !yt || !ytReady) { open(); return; }
    let done = false;
    const go = stopped => {
      if (done) return;
      done = true;
      afterPause = null;
      open();
      if (!stopped) openVideo(vcur, { play: false, at: t, size: vsize, fresh: true });
    };
    afterPause = () => go(true);
    yt.pauseVideo();
    setTimeout(() => go(false), 600);
  });
  // the title leads back to the page the video was opened on; on that page, to its link
  vTitle.addEventListener('click', e => {
    if (!vcur || vcur.page !== location.pathname) return;
    e.preventDefault();
    const l = $('.video-current');
    if (l) l.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  audio.addEventListener('play', () => { if (vplaying && yt && ytReady) yt.pauseVideo(); });
  setInterval(() => { if (vplaying) vsave(); }, 2000);
  addEventListener('pagehide', () => { vsave(); vleaving = true; });
  addEventListener('pageshow', () => { vleaving = false; });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && vsize === 'big' && !document.querySelector('dialog[open]')) setSize('normal');
  });
  document.addEventListener('click', e => {
    const el = e.target.closest('a[data-yt], button[data-yt]');
    if (!el || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    if (vcur && vcur.id === el.dataset.yt) {
      if (vsize === 'min') setSize('normal');
      if (yt && ytReady) vplaying ? yt.pauseVideo() : yt.playVideo();
      return;
    }
    const text = el.tagName === 'A' ? el.textContent.trim() : '';
    openVideo({ id: el.dataset.yt, title: text || el.dataset.ytTitle || 'Videó', page: location.pathname },
              { size: vsize === 'big' ? 'big' : 'normal' });
  });
  // on a new page an enlarged box comes back at its corner size (a minimized one stays minimized)
  // (also when back / forward brings the page back from the browser's page cache, see restoreAudio)
  const restoreVideo = () => {
    const saved = savedState('video');
    if (!saved || !saved.id) { if (vcur) closeVideo(); return; }
    openVideo({ id: saved.id, title: saved.title, page: saved.page },
              { play: !!saved.playing, at: saved.t || 0, size: saved.size === 'min' ? 'min' : 'normal' });
  };
  restoreVideo();
  addEventListener('pageshow', e => { if (e.persisted) restoreVideo(); });

  // document files live on files.gyoripeter.hu, where the download attribute is ignored (other origin):
  // fetch the file and save it under its original name; on failure just open it
  document.addEventListener('click', async e => {
    const a = e.target.closest('a[download]');
    if (!a || a.origin === location.origin || e.metaKey || e.ctrlKey || e.shiftKey || a.getAttribute('aria-busy')) return;
    e.preventDefault();
    a.setAttribute('aria-busy', 'true');
    try {
      const r = await fetch(a.href);
      if (!r.ok) throw new Error(r.status);
      const url = URL.createObjectURL(await r.blob());
      const tmp = Object.assign(document.createElement('a'), { href: url, download: a.getAttribute('download') || '' });
      document.body.append(tmp); tmp.click(); tmp.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      window.open(a.href, '_blank', 'noopener');
    } finally {
      a.removeAttribute('aria-busy');
    }
  });

  // YouTube facades
  $$('.video[data-yt]').forEach(v => {
    const play = () => {
      if (v.classList.contains('playing')) return;
      const f = document.createElement('iframe');
      f.src = `https://www.youtube-nocookie.com/embed/${v.dataset.yt}?autoplay=1&rel=0`;
      f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      f.allowFullscreen = true;
      f.title = 'YouTube videó';
      v.appendChild(f);
      v.classList.add('playing');
    };
    $('.video-play', v).addEventListener('click', play);
    $('img', v).addEventListener('click', play);
  });

  // document / image viewer
  const viewer = $('#viewer');
  const vBody = $('#viewer-body');
  const openViewer = (title, openUrl, node) => {
    $('#viewer-title').textContent = title || '';
    $('#viewer-open').href = openUrl;
    vBody.replaceChildren(node);
    if (!viewer.open) viewer.showModal();
  };
  // image galleries: the viewer pages through the images of the same folder listing (folder pages) or of
  // the page (pictures on content pages) — buttons, arrow keys, swipe; it stops at both ends
  const prevBtn = $('.viewer-prev'), nextBtn = $('.viewer-next'), countEl = $('#viewer-count');
  let gallery = [], gIndex = 0;
  const lbSrc = a => a.dataset.lightbox || a.href;
  const lbFull = src => src.replace(/=w\d+$/, '=w2400');
  const lbTitle = a => a.dataset.lightboxTitle || a.closest('figure')?.querySelector('figcaption')?.textContent.trim() || '';
  const showImage = i => {
    gIndex = i;
    const a = gallery[i], img = new Image();
    img.src = lbFull(lbSrc(a));
    img.alt = lbTitle(a);
    openViewer(lbTitle(a), lbSrc(a), img);
    const many = gallery.length > 1;
    prevBtn.hidden = nextBtn.hidden = countEl.hidden = !many;
    prevBtn.disabled = i === 0;
    nextBtn.disabled = i === gallery.length - 1;
    countEl.textContent = `${i + 1} / ${gallery.length}`;
    [i - 1, i + 1].forEach(j => { if (gallery[j]) new Image().src = lbFull(lbSrc(gallery[j])); });   // preload
  };
  const step = d => { if (gallery[gIndex + d]) showImage(gIndex + d); };
  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));
  document.addEventListener('keydown', e => {
    if (!viewer.open || gallery.length < 2 || e.altKey || e.metaKey || e.ctrlKey) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  });
  let swipe = null;
  const stage = $('.viewer-stage');   // the buttons too: a swipe may start on one
  stage.addEventListener('touchstart', e => { swipe = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
  stage.addEventListener('touchend', e => {
    if (!swipe || gallery.length < 2) return;
    const dx = e.changedTouches[0].clientX - swipe.x, dy = e.changedTouches[0].clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  });
  viewer.addEventListener('close', () => {
    vBody.replaceChildren();
    gallery = [];
    prevBtn.hidden = nextBtn.hidden = countEl.hidden = true;
  });
  viewer.addEventListener('click', e => { if (e.target === viewer) viewer.close(); });
  $$('[data-viewer-close]').forEach(b => b.addEventListener('click', () => viewer.close()));
  $$('[data-preview]').forEach(b => b.addEventListener('click', () => {
    const f = document.createElement('iframe');
    f.src = b.dataset.preview;
    f.allow = 'autoplay; fullscreen';
    f.allowFullscreen = true;
    f.title = b.dataset.title || 'Dokumentum előnézet';
    openViewer(b.dataset.title, b.dataset.open, f);
  }));
  // pictures on pages link straight to the image (data-lightbox empty); image files on folder pages link to
  // their document page and carry the image's address and name (data-lightbox, data-lightbox-title)
  $$('a[data-lightbox]').forEach(a => a.addEventListener('click', e => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    gallery = $$('a[data-lightbox]', a.closest('.folder-list') || a.closest('main') || document);
    showImage(gallery.indexOf(a));
  }));

  // search
  const dlg = $('#search'), input = $('#search-input'), out = $('#search-results');
  let index = null, sel = -1;
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const load = async () => {
    if (index) return index;
    const r = await fetch('/assets/search.json');
    index = (await r.json()).map(p => ({ ...p, nt: norm(p.t), nx: norm(p.x), nc: norm(p.c || '') }));
    return index;
  };
  const openSearch = async () => {
    dlg.showModal();
    input.focus();
    input.select();
    await load();
    render();
  };
  $$('[data-search-open]').forEach(b => b.addEventListener('click', openSearch));
  document.addEventListener('keydown', e => {
    if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) && !dlg.open &&
        !/input|textarea/i.test(document.activeElement.tagName)) {
      e.preventDefault();
      openSearch();
    }
  });
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  const snippet = (p, terms) => {
    const i = wordIndex(p.nx, terms[0]);
    if (i < 0) return esc(p.x.slice(0, 160));
    const s = Math.max(0, i - 60);
    let txt = esc((s ? '…' : '') + p.x.slice(s, s + 200));
    const ntxt = norm(txt);
    // highlight first term (positions line up because NFD stripping keeps length for Hungarian letters)
    const j = wordIndex(ntxt, terms[0]);
    if (j >= 0) txt = txt.slice(0, j) + '<mark>' + txt.slice(j, j + terms[0].length) + '</mark>' + txt.slice(j + terms[0].length);
    return txt;
  };
  const render = () => {
    if (!index) return;
    const q = norm(input.value.trim());
    sel = -1;
    if (!q) {
      out.innerHTML = '<li class="search-empty">Írjon be egy kifejezést – pl. <em>hajléktalan</em>, <em>SZETA</em>, <em>lakbér</em>.</li>';
      return;
    }
    const terms = q.split(/\s+/).filter(Boolean);
    const all = (str) => terms.every(t => hasWord(str, t));
    // three groups: page titles, document titles, pages matching only in their text
    const titles = [], docs = [], texts = [];
    for (const p of index) {
      if (p.k === 'd') { if (all(p.nt)) docs.push(p); continue; }
      if (all(p.nt)) titles.push(p);
      else if (terms.every(t => hasWord(p.nt, t) || hasWord(p.nc, t) || hasWord(p.nx, t))) {
        let score = 0;
        for (const t of terms) score += (hasWord(p.nc, t) ? 3 : 0) + countWord(p.nx, t);
        texts.push([score, p]);
      }
    }
    texts.sort((a, b) => b[0] - a[0]);
    if (!titles.length && !docs.length && !texts.length) { out.innerHTML = '<li class="search-empty">Nincs találat.</li>'; return; }
    const qs = '?q=' + encodeURIComponent(input.value.trim());
    const mark = str => {                      // highlight the terms in a title (accent-insensitive)
      const f = [...str].map(ch => norm(ch).charAt(0) || ch).join('');
      if (f.length !== str.length) return esc(str);
      const on = new Array(str.length).fill(false);
      for (const t of terms) for (let i = wordIndex(f, t); i >= 0; i = wordIndex(f, t, i + 1)) for (let k = i; k < i + t.length; k++) on[k] = true;
      let html = '', open = false;
      [...str].forEach((ch, i) => {
        if (on[i] && !open) { html += '<mark>'; open = true; }
        if (!on[i] && open) { html += '</mark>'; open = false; }
        html += esc(ch);
      });
      return html + (open ? '</mark>' : '');
    };
    const item = (p, snip) => `<li><a href="${esc(p.u + (p.k === 'd' ? '' : qs))}">
      <div class="sr-title">${p.y ? `<span class="yr">${esc(p.y)}</span>` : ''}${mark(p.t)}</div>
      ${p.c ? `<div class="sr-crumb">${esc(p.c)}</div>` : ''}
      ${snip ? `<div class="sr-snip">${snippet(p, terms)}</div>` : ''}</a></li>`;
    const group = (label, list, snip, max) => list.length ? `<li class="sr-group">${label}<span>${list.length}</span></li>` +
      list.slice(0, max).map(p => item(p, snip)).join('') +
      (list.length > max ? `<li class="sr-more">… és még ${list.length - max}</li>` : '') : '';
    out.innerHTML = group('Oldalcímek', titles, false, 12) + group('Dokumentumok', docs, false, 12) +
      group('Szövegben', texts.map(([, p]) => p), true, 30);
  };
  input.addEventListener('input', render);

  // highlight search terms when arriving from a search result
  const highlight = q => {
    const terms = norm(q).split(/\s+/).filter(t => t.length > 1);
    const scope = $('main');
    if (!terms.length || !scope) return [];
    const fold = ch => norm(ch).charAt(0) || ch;   // per-character fold keeps indices aligned
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.nodeValue.trim() && !n.parentElement.closest('script, style, .search-hit-bar')
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const marks = [];
    for (const node of nodes) {
      const text = node.nodeValue;
      const folded = [...text].map(fold).join('');
      if (folded.length !== text.length) continue;
      const ranges = [];
      for (const t of terms) {
        let i = wordIndex(folded, t);
        while (i >= 0) { ranges.push([i, i + t.length]); i = wordIndex(folded, t, i + t.length); }
      }
      if (!ranges.length) continue;
      ranges.sort((a, b) => a[0] - b[0]);
      const frag = document.createDocumentFragment();
      let pos = 0;
      for (const [a, b] of ranges) {
        if (a < pos) continue;
        if (a > pos) frag.append(text.slice(pos, a));
        const m = document.createElement('mark');
        m.className = 'search-hit';
        m.textContent = text.slice(a, b);
        frag.append(m);
        marks.push(m);
        pos = b;
      }
      if (pos < text.length) frag.append(text.slice(pos));
      node.replaceWith(frag);
    }
    return marks;
  };
  const params = new URLSearchParams(location.search);
  const q = params.get('q');
  if (q) {
    const marks = highlight(q);
    const bar = document.createElement('div');
    bar.className = 'search-hit-bar';
    bar.setAttribute('role', 'status');
    let cur = 0;
    const go = i => {
      if (!marks.length) return;
      marks[cur].classList.remove('current');
      cur = (i + marks.length) % marks.length;
      const m = marks[cur];
      m.classList.add('current');
      for (let d = m.closest('details'); d; d = d.parentElement.closest('details')) d.open = true;
      m.scrollIntoView({ block: 'center', behavior: i === 0 && cur === 0 ? 'auto' : 'smooth' });
      count.textContent = `${cur + 1} / ${marks.length}`;
    };
    bar.innerHTML = `<span class="shb-q"></span><span class="shb-count"></span>
      <button type="button" class="shb-btn" data-d="-1" aria-label="Előző találat">↑</button>
      <button type="button" class="shb-btn" data-d="1" aria-label="Következő találat">↓</button>
      <button type="button" class="shb-btn" data-close aria-label="Kiemelés törlése">✕</button>`;
    $('.shb-q', bar).textContent = `„${q}”`;
    const count = $('.shb-count', bar);
    count.textContent = marks.length ? `1 / ${marks.length}` : 'nincs találat az oldalon';
    bar.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-close')) {
        marks.forEach(m => m.replaceWith(m.textContent));
        bar.remove();
        history.replaceState(null, '', location.pathname + location.hash);
      } else go(cur + Number(b.dataset.d));
    });
    document.body.append(bar);
    if (marks.length) requestAnimationFrame(() => go(0));
  }
  input.addEventListener('keydown', e => {
    const links = $$('a', out);
    if (!links.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
      links.forEach((l, i) => l.classList.toggle('sel', i === sel));
      links[sel].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      location.href = links[Math.max(sel, 0)].href;
    }
  });
})();
