(() => {
  'use strict';
  const C = ADCore;
  // randomUUID is secure-context-only; HTTP router/admin pages need the same
  // startup and OFF cleanup. getRandomValues is available on HTTP as well.
  const token = `ad-${Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('')}`;
  const attr = `data-${token}`;
  const records = new Map();
  const sheets = new Map();
  const selectSheets = new Map();
  const roots = new Set([document]);
  const surfaceCache = new WeakMap();
  const tiles = new Map();
  let config = C.defaults, hostname = location.hostname, inheritedNative = false;
  let themePalette = C.palette(config.temperature);
  let nativeCanvas = [255, 255, 255, 1];
  let siteBackground = null;
  let state = 'waiting', reason = '', timer = 0, full = true, ready = false;
  let sequence = 0, lastRun = 0, lastStatus = '', stopped = false;
  let refreshVersion = 0;
  let editDeadline = 0;
  let composing = false;
  let nativeDecision = null;
  let loadingSheet = null, loadingColors = '', savedPhase, phaseRoot = null;
  function phase(value) {
    const root = document.documentElement;
    if (!root) return;
    if (!root.hasAttribute('data-ad-started')) root.setAttribute('data-ad-started', token);
    if (phaseRoot !== root) { phaseRoot = root; savedPhase = root.getAttribute('data-ad-phase'); }
    if (value) { if (root.getAttribute('data-ad-phase') !== value) root.setAttribute('data-ad-phase', value); }
    else if (savedPhase === null) root.removeAttribute('data-ad-phase');
    else root.setAttribute('data-ad-phase', savedPhase);
  }
  function guard(value = config) {
    if (!value.enabled || value.mode === 'off') { removeGuard(); return; }
    if (!document.documentElement) return;
    if (!loadingSheet) { loadingSheet = document.createElement('style'); loadingSheet.setAttribute('data-ad-sheet', `${token}-loading`); }
    const bg = C.background([255, 255, 255, 1], value.brightness, value.temperature);
    const fg = C.foreground([20, 20, 20, 1], bg, value.contrast, value.temperature);
    const text = `html{--ad-loading-bg:${C.css(bg)}!important;--ad-loading-fg:${C.css(fg)}!important}\n${C.loadingCSS(token)}`;
    if (text !== loadingColors) { loadingColors = text; loadingSheet.textContent = text; }
    const container = document.head || document.documentElement;
    // Keep the site's sheets first: scripts may use styleSheets[0] for CSSOM
    // updates. The startup sheet is moved out of html when head becomes ready.
    if (loadingSheet.parentNode !== container || (document.styleSheets[0]?.ownerNode === loadingSheet && document.styleSheets.length > 1)) container.append(loadingSheet);
    phase(state === 'active' ? 'active' : 'loading');
  }
  function removeGuard() {
    loadingSheet?.remove(); loadingSheet = null; loadingColors = ''; phase(null);
  }
  const dirty = new Set();
  const shallow = new Set();
  const interactions = new Set();
  let needsCleanup = false;
  let pending = [];
  const excluded = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'NOSCRIPT', 'TEMPLATE', 'IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'SOURCE', 'OPTION', 'OPTGROUP']);
  const geometry = new Set(['transform', 'transform-origin', 'translate', 'rotate', 'scale', 'top', 'right', 'bottom', 'left', 'inset', 'inset-inline-start', 'inset-inline-end', 'inset-block-start', 'inset-block-end', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'z-index', 'cursor', 'opacity', 'display', 'visibility']);
  const inertAttributes = new Set(['value', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-activedescendant', 'aria-controls', 'aria-autocomplete', 'aria-live', 'aria-atomic', 'aria-busy']);
  function isStylesheet(e) { return e.matches?.('style,link[rel~="stylesheet"]'); }
  function stylesheetNodes(nodes) {
    return [...nodes].some(n => n.nodeType === 1 && ((isStylesheet(n) && !n.hasAttribute('data-ad-sheet')) || n.querySelector('style:not([data-ad-sheet]),link[rel~="stylesheet"]')));
  }
  const previousStyle = document.createElement('span').style;
  function styleChanged(e, oldValue) {
    previousStyle.cssText = oldValue || '';
    const current = e.style;
    for (const prop of new Set([...previousStyle, ...current])) {
      if (geometry.has(prop)) continue;
      if (previousStyle.getPropertyValue(prop) !== current.getPropertyValue(prop) || previousStyle.getPropertyPriority(prop) !== current.getPropertyPriority(prop)) return true;
    }
    return false;
  }
  const observer = new MutationObserver(changes => {
    let changed = false;
    let protectCanvas = false;
    const urgent = new Set();
    for (const change of changes) {
      const e = change.target.nodeType === 1 ? change.target : change.target.parentElement;
      if (!e || e.closest?.('script, style[data-ad-sheet]') || e.namespaceURI === 'http://www.w3.org/2000/svg') continue;
      if (change.type === 'childList' && e.closest('head') && !isStylesheet(e)) {
        if (stylesheetNodes([...change.addedNodes, ...change.removedNodes])) { full = true; changed = true; }
        continue;
      }
      if (e.closest('head') && !isStylesheet(e) && !e.closest('style')) continue;
      if (excluded.has(e.tagName) && !isStylesheet(e)) continue;
      if (change.type === 'attributes') {
        if (['data-ad-phase', 'data-ad-rendered', 'data-ad-started'].includes(change.attributeName)) continue;
        // Libraries such as Select2 write the same attribute value again while
        // reacting to style mutations. That must not start a feedback loop.
        if (e.getAttribute(change.attributeName) === change.oldValue) continue;
        if (inertAttributes.has(change.attributeName)) continue;
        if (change.attributeName === 'style' && !styleChanged(e, change.oldValue)) continue;
        if (e === document.documentElement || e === document.body) protectCanvas = true;
        if (change.attributeName === 'style' && e.style.getPropertyPriority('background-color') === 'important' && urgent.size < 16) urgent.add(e);
      }
      // Native select menus inherit their palette from select; thousands of
      // option data records need no individual inline styles or pseudo reads.
      if (e.closest('option,optgroup')) continue;
      changed = true;
      if (e.closest('head') || isStylesheet(e) || (change.type === 'attributes' && (e === document.documentElement || e === document.body))) full = true;
      else if (change.type === 'childList') {
        if (change.removedNodes.length) needsCleanup = true;
        if (e !== document.documentElement && e !== document.body) shallow.add(e);
        for (const node of change.addedNodes) if (node.nodeType === 1) dirty.add(node);
        if (e === document.documentElement || !loadingSheet?.isConnected) protectCanvas = true;
        for (const node of change.addedNodes) if (node.nodeType === 1 && urgent.size < 16) {
          if (node.style?.getPropertyPriority('background-color') === 'important') urgent.add(node);
          if (node.childElementCount && !excluded.has(node.tagName)) {
            for (const child of node.querySelectorAll('[style*="important"]')) {
              if (urgent.size >= 16) break;
              if (child.style.getPropertyPriority('background-color') === 'important' || child.style.getPropertyPriority('color') === 'important') urgent.add(child);
            }
          }
        }
      } else if (change.type === 'characterData') shallow.add(e);
      else {
        dirty.add(e);
        if (/theme|color-mode/i.test(change.attributeName) ||
          (change.attributeName === 'style' && e.matches('main,[role="main"],#app,#root')) ||
          (change.attributeName === 'class' && /(^|[\s_-])(dark|night|light)([\s_-]|$)/i.test(`${change.oldValue || ''} ${e.className}`))) full = true;
      }
      if (change.type === 'childList') {
        if (stylesheetNodes([...change.addedNodes, ...change.removedNodes])) full = true;
        for (const node of change.addedNodes) if (node.nodeType === 1 && node.matches('main,[role="main"],#app,#root')) full = true;
      }
    }
    if (changed) {
      if (config.enabled && config.mode !== 'off' && state !== 'native' && loadingSheet) {
        if (protectCanvas || urgent.size) shield(protectCanvas ? [document.documentElement, document.body, ...urgent] : [...urgent]);
      }
      schedule();
    }
  });
  function observe() {
    for (const root of roots) observer.observe(root, { subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true });
  }
  function parent(e) { return e.assignedSlot || e.parentElement || e.getRootNode().host || null; }
  function eventTarget(e) { return e.composedPath?.()[0] || e.target; }
  function color(value) {
    const parsed = C.parse(value);
    if (parsed) return parsed;
    // Canvas resolves named colors, hsl(), lab(), oklch(), color-mix(), etc.
    // It is a private 1px canvas, never a site's image or screenshot.
    const ctx = color.ctx ||= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!CSS.supports('color', value || '')) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return [data[0], data[1], data[2], data[3] / 255];
  }
  function suspend(selected = records) {
    if (selected === records || [...selected.values()].some(r => r.pseudo.length || r.interactionRules?.size)) {
      for (const sheet of sheets.values()) sheet.disabled = true;
    }
    for (const [e, r] of selected) restore(e, r);
  }
  function restore(e, r) {
    for (const [prop, applied] of r.applied) {
      // A site's newer inline edit always wins over an old saved value.
      if (e.style.getPropertyValue(prop) !== applied.value || e.style.getPropertyPriority(prop) !== applied.priority) continue;
      const saved = r.original.get(prop);
      if (saved.value) e.style.setProperty(prop, saved.value, saved.priority);
      else e.style.removeProperty(prop);
    }
    if (!r.hadStyle && e.style.length === 0) e.removeAttribute('style');
  }
  function apply(e, r) {
    // Reading/writing CSSStyleDeclaration can leave an empty style attribute.
    // Preserve the original attribute presence across repeated scans.
    r.original.clear(); r.applied.clear();
    for (const [prop, value] of Object.entries(r.plan)) {
      r.original.set(prop, { value: e.style.getPropertyValue(prop), priority: e.style.getPropertyPriority(prop) });
      if (e.style.getPropertyValue(prop) !== value || e.style.getPropertyPriority(prop) !== 'important') e.style.setProperty(prop, value, 'important');
      r.applied.set(prop, { value: e.style.getPropertyValue(prop), priority: e.style.getPropertyPriority(prop) });
    }
    mark(e);
  }
  function record(e) {
    let r = records.get(e);
    if (!r) { r = { plan: {}, original: new Map(), applied: new Map(), hadStyle: e.hasAttribute('style'), pseudo: [], id: '', savedAttr: e.getAttribute(attr), savedPaint: e.getAttribute('data-ad-rendered') }; records.set(e, r); }
    return r;
  }
  function mark(e) {
    if (e.getAttribute('data-ad-rendered') !== token) e.setAttribute('data-ad-rendered', token);
  }
  function unmark(e, r) {
    if (e.getAttribute('data-ad-rendered') !== token) return;
    if (r.savedPaint === null) e.removeAttribute('data-ad-rendered');
    else e.setAttribute('data-ad-rendered', r.savedPaint);
  }
  function shield(nodes = [document.documentElement, document.body]) {
    // Protect the canvas and explicitly white inline surfaces synchronously,
    // before the browser paints. This touches bounded roots, not whole lists.
    const elements = [...new Set(nodes)].filter(e => e?.isConnected && !excluded.has(e.tagName) && e.namespaceURI !== 'http://www.w3.org/2000/svg');
    if (!elements.length) return;
    observer.disconnect();
    const canvas = elements.some(e => e === document.documentElement || e === document.body);
    if (canvas) phase('analyzing');
    const selected = new Map(elements.filter(e => records.has(e)).map(e => [e, records.get(e)]));
    for (const [e, r] of selected) restore(e, r);
    for (const e of elements) { record(e); mark(e); }
    const plans = elements.map(e => ({ e, cs: getComputedStyle(e) }));
    for (const { e, cs } of plans) {
      const native = originalColors(e, cs);
      const data = planStyle(cs, inheritedSurfaces(e), e === document.documentElement, native);
      const r = record(e);
      r.nativeColors = native; r.plan = data.plan; surfaceCache.set(e, data.surfaces);
      apply(e, r);
    }
    if (canvas) guard();
    observe();
  }
  function cleanup() {
    for (const [e, r] of records) {
      if (!r.hadStyle && !e.style.cssText.trim()) e.removeAttribute('style');
      if (r.id) { if (r.savedAttr === null) e.removeAttribute(attr); else e.setAttribute(attr, r.savedAttr); }
      unmark(e, r);
    }
    records.clear();
    for (const sheet of sheets.values()) sheet.remove();
    sheets.clear();
    for (const sheet of selectSheets.values()) sheet.remove();
    selectSheets.clear();
  }
  function originalSurface(e) {
    const chain = [];
    for (let p = e; p; p = parent(p)) chain.push(p);
    let bg = nativeCanvas;
    for (const p of chain.reverse()) {
      const cs = getComputedStyle(p);
      const c = color(cs.backgroundColor);
      if (c) bg = C.blend(c, bg);
      if (cs.backgroundImage.includes('gradient(')) {
        const stops = [...cs.backgroundImage.matchAll(/rgba?\([^)]*\)|color\([^)]*\)/g)].map(m => color(m[0])).filter(Boolean);
        if (stops.length) bg = C.blend(stops[0], bg);
      }
    }
    return bg;
  }
  function sampleSurfaces() {
    const samples = [], body = document.body;
    for (let row = 0; row < 5; row++) for (let col = 0; col < 7; col++) {
      const x = (col + .5) * innerWidth / 7, y = (row + .5) * innerHeight / 5;
      let e = document.elementFromPoint(x, y);
      if (!e) continue;
      while (e.shadowRoot?.elementFromPoint(x, y) && e.shadowRoot.elementFromPoint(x, y) !== e) e = e.shadowRoot.elementFromPoint(x, y);
      if (e.closest('img,video,canvas,svg,iframe,object')) e = parent(e) || body;
      if (!e) continue;
      const cs = getComputedStyle(e);
      // A photo-heavy viewport is not reliable evidence of a native dark theme.
      if (cs.backgroundImage.includes('url(')) continue;
      const bg = originalSurface(e), fg = color(cs.color);
      samples.push({ bg, fg });
    }
    return samples;
  }
  function dominantBackground(samples) {
    // Prefer the most common visible surface, including app wrappers, rather
    // than a possibly transparent body or a small card beneath the pointer.
    const groups = new Map();
    for (const { bg } of samples) {
      const key = bg.slice(0, 3).map(v => Math.round(v / 12)).join(',');
      const group = groups.get(key) || { count: 0, sum: [0, 0, 0] };
      group.count++; bg.slice(0, 3).forEach((v, i) => { group.sum[i] += v; });
      groups.set(key, group);
    }
    const dominant = [...groups.values()].sort((a, b) => b.count - a.count)[0];
    return dominant ? dominant.sum.map(v => Math.round(v / dominant.count)).concat(1) : originalSurface(document.body);
  }
  function detectNative(samples) {
    // The extension's own overrides have been suspended before this check.
    // Theme markers are corroborating evidence, never sufficient by themselves.
    const html = document.documentElement, body = document.body;
    const marker = [html, body].filter(Boolean).some(e => /(^|[\s_-])(dark|night)([\s_-]|$)/i.test(`${e.className} ${e.getAttribute('data-theme') || ''} ${e.getAttribute('data-color-mode') || ''} ${e.getAttribute('data-bs-theme') || ''}`));
    const scheme = getComputedStyle(html).colorScheme.trim() === 'dark';
    const count = samples.length;
    let dark = 0, readable = 0;
    for (const { bg, fg } of samples) {
      if (C.luminance(bg) < .14) {
        dark++;
        if (fg && C.contrast(fg, bg) >= 3.5) readable++;
      }
    }
    const threshold = marker || scheme ? .72 : .86;
    // SPA/search pages can paint an opaque dark app wrapper over a transparent
    // html/body. The visible surfaces, rather than the root alone, decide.
    if (count < 12 || dark / count < threshold) return false;
    if (readable / Math.max(dark, 1) >= .8) return true;
    // Empty search-page columns often inherit an unused black root text color.
    // In that case inspect actual visible text instead of that container color.
    let textCount = 0, textReadable = 0, examined = 0;
    for (const e of document.querySelectorAll('body *')) {
      if (excluded.has(e.tagName) || e.namespaceURI === 'http://www.w3.org/2000/svg') continue;
      if (![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      if (++examined > 1200) break;
      const rect = e.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2 || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) continue;
      const cs = getComputedStyle(e), fg = color(cs.color), bg = originalSurface(e);
      if (cs.visibility !== 'visible' || Number(cs.opacity) === 0 || !fg) continue;
      textCount++;
      if (C.luminance(bg) < .14 && C.contrast(fg, bg) >= 3.5) textReadable++;
      if (textCount >= 100) break;
    }
    return textCount >= 2 && textReadable / textCount >= .8;
  }
  function recognizeNative() {
    // Read only after suspending our own styles. Scrolling changes viewport
    // samples (and sticky-header classes), but does not change the site theme.
    // Keep that decision until the original page-wide palette/theme changes.
    const html = document.documentElement, body = document.body;
    const app = document.querySelector('main,[role="main"],#app,#root,#__next,#__nuxt,#react-layout');
    // A parser/loading skeleton is provisional; revisit it at DOM/load rather
    // than retaining that initial sample after the document finishes loading.
    const signature = [location.origin + location.pathname + location.search, document.readyState];
    for (const e of [html, body, app].filter(Boolean)) {
      const cs = getComputedStyle(e);
      signature.push(cs.backgroundColor, cs.color, cs.colorScheme);
      // Do not include arbitrary classes/inline styles: scroll animations and
      // header visibility use those too. Explicit theme signals still matter.
      signature.push([...String(e.className).matchAll(/(?:^|[\s_-])(dark|night|light)(?=[\s_-]|$)/gi)].map(m => m[1].toLowerCase()).sort().join(','));
      for (const name of ['data-theme', 'data-color-mode', 'data-bs-theme']) signature.push(e.getAttribute(name) || '');
    }
    const key = signature.join('\n');
    if (nativeDecision?.key === key && nativeDecision.html === html && nativeDecision.body === body && nativeDecision.app === app) return nativeDecision;
    const samples = sampleSurfaces();
    nativeDecision = { key, html, body, app, native: detectNative(samples), background: dominantBackground(samples) };
    return nativeDecision;
  }
  function collect(root, output, seen) {
    if (!root || seen.has(root)) return;
    // Iterative traversal also handles deeply nested components without
    // overflowing the JavaScript call stack.
    const stack = root.nodeType === 1 ? [root] : [...(root.children || [])].reverse();
    while (stack.length) {
      const e = stack.pop();
      if (seen.has(e)) continue;
      seen.add(e);
      if (excluded.has(e.tagName) || e.namespaceURI === 'http://www.w3.org/2000/svg') continue;
      output.push(e);
      for (let i = e.children.length - 1; i >= 0; i--) stack.push(e.children[i]);
      if (e.shadowRoot) {
        roots.add(e.shadowRoot);
        for (let i = e.shadowRoot.children.length - 1; i >= 0; i--) stack.push(e.shadowRoot.children[i]);
      }
    }
  }
  function inheritedSurfaces(e) {
    const p = parent(e);
    return (p && surfaceCache.get(p)) || [C.base(config.brightness, config.temperature)];
  }
  function tile(image, cs) {
    if (!image.includes('url(') || image.includes('gradient(')) return false;
    const match = image.match(/^url\(["']?(.+?)["']?\)$/);
    if (!match) return false;
    const url = match[1];
    if (tiles.has(url)) return tiles.get(url) === true;
    tiles.set(url, false);
    // Existing decorative backgrounds only. Do not read pixels or re-color photos.
    const img = new Image();
    img.onload = () => {
      const small = Math.min(img.naturalWidth, img.naturalHeight);
      const large = Math.max(img.naturalWidth, img.naturalHeight);
      // Legacy boxes commonly use a 1–16px repeated strip, or a wide sprite
      // holding several header/button states (e.g. 1720×100). no-repeat is also
      // used for their matching top/bottom caps. Ordinary square icons and
      // photographs are retained; dimensions are a conservative heuristic.
      const strip = small <= 16 && large >= 32;
      const sprite = small <= 128 && large >= 160 && large / Math.max(small, 1) >= 6;
      const repeatedTile = large <= 128 && cs.backgroundRepeat !== 'no-repeat';
      if (strip || sprite || repeatedTile) { tiles.set(url, true); full = true; schedule(); }
    };
    img.src = url;
    return false;
  }
  function originalColors(e, cs) {
    const result = { color: cs.color, webkitTextFillColor: cs.webkitTextFillColor, backgroundColor: cs.backgroundColor };
    for (const [key, prop] of [['color', 'color'], ['webkitTextFillColor', '-webkit-text-fill-color'], ['backgroundColor', 'background-color']]) {
      // An untouched parent's inline override can be inherited by a new child.
      // Substitute its saved native value, rather than restoring the parent and
      // invalidating styles for thousands of unrelated descendants.
      if (e.style.getPropertyValue(prop)) continue;
      for (let p = parent(e); p; p = parent(p)) {
        const r = records.get(p), applied = r?.applied.get(prop);
        if (r?.nativeColors && applied && p.style.getPropertyValue(prop) === applied.value && p.style.getPropertyPriority(prop) === applied.priority && result[key] === getComputedStyle(p)[key]) {
          result[key] = key === 'webkitTextFillColor' && r.nativeColors[key] === r.nativeColors.color ? result.color : r.nativeColors[key];
          break;
        }
        if (p.style.getPropertyValue(prop)) break;
      }
    }
    return result;
  }
  function planStyle(cs, parents, isRoot = false, native = cs) {
    const plan = {};
    const bg = color(native.backgroundColor) || [0, 0, 0, 0];
    const mapped = C.background(bg, config.brightness, config.temperature);
    // Lock transparent/none values too. Otherwise a :hover rule introduces a
    // white background/image until the debounced analysis catches up.
    plan['background-color'] = C.css(isRoot && !mapped[3] ? C.base(config.brightness, config.temperature) : mapped);
    let surfaces = mapped[3] ? parents.map(p => C.blend(mapped, p)) : parents;
    if (isRoot && !mapped[3]) surfaces = [C.base(config.brightness, config.temperature)];
    const gradient = C.gradient(cs.backgroundImage, config.brightness, config.temperature);
    plan['background-image'] = gradient.image;
    if (gradient.colors.length) surfaces = gradient.colors.map(c => C.blend(c, surfaces[0]));
    if (cs.backgroundImage.includes('url(') && (config.suppressImages || tile(cs.backgroundImage, cs))) {
      plan['background-image'] = 'none';
      if (!mapped[3]) { plan['background-color'] = C.css(C.base(config.brightness, config.temperature)); surfaces = [C.base(config.brightness, config.temperature)]; }
    }
    const fg = C.foreground(color(native.color), surfaces, config.contrast, config.temperature);
    if (fg) plan.color = C.css(fg);
    const fill = color(native.webkitTextFillColor);
    if (fill) plan['-webkit-text-fill-color'] = C.css(fill[3] > 0 && cs.backgroundClip !== 'text' ? C.foreground(fill, surfaces, config.contrast, config.temperature) : fill);
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const c = color(cs.getPropertyValue(`border-${side}-color`));
      // Lock dark and transparent visible borders too: a later hover/focus rule
      // must not expose a bright line between two debounced scans.
      if (c && cs.getPropertyValue(`border-${side}-style`) !== 'none') {
        plan[`border-${side}-color`] = C.css(C.parse(themePalette.pageBorder).slice(0, 3).concat(c[3]));
      }
    }
    // Light inset shadows are a common source of white strips in older sites.
    if (cs.boxShadow !== 'none') plan['box-shadow'] = cs.boxShadow.replace(/rgba?\([^)]*\)|color\([^)]*\)/g, s => {
      const c = color(s); return c ? C.css(C.background(c, config.brightness, config.temperature)) : s;
    });
    if (cs.textShadow !== 'none') plan['text-shadow'] = 'none';
    if (cs.transitionDuration.split(',').some(v => parseFloat(v) > 0)) {
      // CSS transitions outrank even inline !important. Suspending our colors
      // for analysis must not start a transition through the site's white color.
      const animatedColors = /^(all|background(?:-.+)?|color|border(?:-.+)?|outline(?:-.+)?|box-shadow|text-shadow|-webkit-text-fill-color|fill|stroke)$/;
      const properties = cs.transitionProperty.split(',').map(p => p.trim());
      const safe = properties.includes('all')
        ? ['opacity', 'transform', 'translate', 'rotate', 'scale', 'width', 'height', 'max-width', 'max-height', 'min-width', 'min-height', 'padding', 'margin', 'top', 'right', 'bottom', 'left', 'inset', 'border-radius', 'flex-basis']
        : properties.filter(p => !animatedColors.test(p));
      plan['transition-property'] = safe.join(', ') || 'none';
      if (safe.length) {
        for (const prop of ['transition-duration', 'transition-delay', 'transition-timing-function']) {
          // Keep each remaining animation's own timing after removing colors.
          const values = cs.getPropertyValue(prop).split(/,(?![^()]*\))/).map(v => v.trim());
          plan[prop] = safe.map(p => {
            let index = 0;
            for (let i = 0; i < properties.length; i++) if (properties[i] === 'all' || properties[i] === p) index = i;
            return values[index % values.length];
          }).join(', ');
        }
      }
    }
    if (isRoot) { plan['color-scheme'] = 'dark'; plan['scrollbar-color'] = `${themePalette.scrollbar} ${C.css(C.base(config.brightness, config.temperature))}`; }
    return { plan, surfaces };
  }
  function publish() {
    const status = `${state}:${reason}:${siteBackground ? C.css(siteBackground) : ''}`;
    if (window === window.top && lastStatus !== status) {
      lastStatus = status;
      chrome.runtime.sendMessage({ type: 'AD_STATUS', state }).catch(() => {});
    }
  }
  function updateSheets() {
    const rules = new Map();
    for (const [e, r] of records) {
      if (!e.isConnected || (!r.pseudo.length && !r.interactionRules?.size)) continue;
      r.id ||= String(++sequence);
      if (e.getAttribute(attr) !== r.id) e.setAttribute(attr, r.id);
      const root = e.getRootNode();
      if (!rules.has(root)) rules.set(root, []);
      for (const p of r.pseudo) rules.get(root).push(`[${attr}="${r.id}"]${p.pseudo}{${Object.entries(p.plan).map(([k, v]) => `${k}:${v}!important`).join(';')}}`);
      for (const [selector, plan] of r.interactionRules || []) rules.get(root).push(`:is(#${token},[${attr}="${r.id}"])${selector}{${Object.entries(plan).map(([k, v]) => `${k}:${v}!important`).join(';')}}`);
    }
    for (const root of roots) {
      const container = root === document ? document.head || document.documentElement : root;
      let sheet = sheets.get(root);
      if (!sheet) {
        sheet = document.createElement('style'); sheet.setAttribute('data-ad-sheet', token);
        sheets.set(root, sheet);
      }
      if (sheet.parentNode !== container) container.append(sheet);
      const text = (rules.get(root) || []).join('\n');
      if (sheet.textContent !== text) sheet.textContent = text;
      sheet.disabled = false;
      if (!selectSheets.has(root)) {
        const menu = document.createElement('style'); menu.setAttribute('data-ad-sheet', token);
        menu.textContent = 'select option,select optgroup{background-color:inherit!important;color:inherit!important;-webkit-text-fill-color:inherit!important}';
        selectSheets.set(root, menu);
      }
      const menu = selectSheets.get(root);
      if (menu.parentNode !== container) container.append(menu);
    }
  }
  function paintInteractions() {
    let changed = false;
    for (const e of interactions) {
      const r = records.get(e);
      if (!e.isConnected || !r) continue;
      // Existing inline colors already lock hover/focus backgrounds. Restoring
      // them on every pointer crossing wakes unrelated site observers (e.g.
      // auto-scroll on a schedule panel). Only newly exposed decoration needs
      // a plan; ordinary pointer movement performs no attribute writes.
      const cs = getComputedStyle(e), extra = {};
      for (const side of ['top', 'right', 'bottom', 'left']) {
        const prop = `border-${side}-color`;
        if (!(prop in r.plan) && cs.getPropertyValue(`border-${side}-style`) !== 'none') {
          const c = color(cs.getPropertyValue(prop));
          if (c) extra[prop] = C.css(C.parse(themePalette.pageBorder).slice(0, 3).concat(c[3]));
        }
      }
      if (!('box-shadow' in r.plan) && cs.boxShadow !== 'none') extra['box-shadow'] = cs.boxShadow.replace(/rgba?\([^)]*\)|color\([^)]*\)/g, s => {
        const c = color(s); return c ? C.css(C.background(c, config.brightness, config.temperature)) : s;
      });
      if (!('text-shadow' in r.plan) && cs.textShadow !== 'none') extra['text-shadow'] = 'none';
      const selector = `${e.matches(':hover') ? ':hover' : ':not(:hover)'}${e.matches(':focus-within') ? ':focus-within' : ':not(:focus-within)'}`;
      if (Object.keys(extra).length && !r.interactionRules?.has(selector)) {
        // Conditional CSS lets shadows/decorations disappear on pointer exit,
        // without repeatedly changing an observed element's inline attributes.
        r.interactionRules ||= new Map();
        r.interactionRules.set(selector, extra); changed = true;
      }
      for (const pseudo of ['::before', '::after']) {
        if (r.pseudo.some(p => p.pseudo === pseudo)) continue;
        const pcs = getComputedStyle(e, pseudo);
        if (pcs.content === 'none' || pcs.content === 'normal') continue;
        const native = { backgroundColor: pcs.backgroundColor, color: pcs.color === cs.color ? r.nativeColors.color : pcs.color,
          webkitTextFillColor: pcs.webkitTextFillColor === cs.webkitTextFillColor ? r.nativeColors.webkitTextFillColor : pcs.webkitTextFillColor };
        r.pseudo.push({ pseudo, plan: planStyle(pcs, surfaceCache.get(e) || inheritedSurfaces(e), false, native).plan });
        changed = true;
      }
    }
    interactions.clear();
    if (changed) updateSheets();
  }
  function run() {
    timer = 0;
    if (!ready || !document.body || stopped) return;
    // Keep IME/paste/typing responsive if a stylesheet or a large result list
    // changes at the same time. Small suggestion updates can still run now.
    if (config.enabled && config.mode !== 'off' && (full || pending.length) && (composing || performance.now() < editDeadline)) {
      timer = setTimeout(run, composing ? 180 : Math.ceil(editDeadline - performance.now()));
      return;
    }
    lastRun = performance.now();
    observer.disconnect();
    if (state === 'active' && !full && !needsCleanup && !pending.length && !dirty.size && !shallow.size) {
      paintInteractions(); observe(); return;
    }
    const scanAll = full || records.size === 0 || state !== 'active';
    // Full detection needs original canvas colors. Partial scans only release
    // their own nodes, avoiding a whole-page CSS invalidation while typing.
    if (scanAll) phase('analyzing');
    const elements = [], seen = new Set();
    if (scanAll) { pending = []; collect(document.documentElement, elements, seen); }
    else {
      for (const e of dirty) if (e.isConnected) collect(e, elements, seen);
      for (const e of shallow) if (e.isConnected && !seen.has(e) && !excluded.has(e.tagName)) { seen.add(e); elements.push(e); }
      for (const e of pending) if (e.isConnected && !seen.has(e)) { seen.add(e); elements.push(e); }
      // Process parents first even when child-list and attribute records arrive
      // in a different order, so inherited background caches stay correct.
      elements.sort((a, b) => a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    }
    // Search widgets can insert thousands of rendered results at once. Yield
    // between bounded batches so typing and dragging can interrupt that work.
    pending = elements.splice(400);
    const selected = scanAll ? records : new Map();
    if (!scanAll) for (const e of elements) { const r = records.get(e); if (r) selected.set(e, r); }
    // Restore only the affected elements. Rewriting every existing element for
    // a tiny change triggered third-party observers and inherited-style work.
    suspend(selected);
    if (!scanAll) for (const e of elements) { record(e); mark(e); }
    // HTML propagates a body's background onto the document canvas when the
    // root is transparent. Below a short body's bounds, elementFromPoint sees
    // html even though the visible canvas is still the body's dark background.
    nativeCanvas = [255, 255, 255, 1];
    const rootStyle = getComputedStyle(document.documentElement);
    const rootColor = color(rootStyle.backgroundColor);
    if ((!rootColor || rootColor[3] === 0) && rootStyle.backgroundImage === 'none') {
      const bodyColor = color(getComputedStyle(document.body).backgroundColor);
      if (bodyColor) nativeCanvas = C.blend(bodyColor, nativeCanvas);
    }
    for (const [e, r] of records) if (!e.isConnected) { restore(e, r); if (r.id) e.removeAttribute(attr); unmark(e, r); records.delete(e); }
    for (const root of roots) if (root.host && !root.host.isConnected) { sheets.get(root)?.remove(); sheets.delete(root); selectSheets.get(root)?.remove(); selectSheets.delete(root); roots.delete(root); }
    needsCleanup = false;
    if (scanAll) {
      const decision = config.enabled && config.mode === 'auto' ? recognizeNative() : null;
      if (!config.enabled || config.mode === 'off') { state = 'off'; reason = chrome.i18n.getMessage('reasonOff'); }
      else if (config.mode === 'auto' && ((window !== window.top && inheritedNative) || decision.native)) { state = 'native'; reason = chrome.i18n.getMessage('reasonNative'); }
      else { state = 'active'; reason = config.mode === 'on' ? 'ON' : chrome.i18n.getMessage('reasonActive'); }
      siteBackground = state === 'active' ? null : decision?.background || dominantBackground(sampleSurfaces());
    }
    if (state !== 'active') {
      removeGuard(); cleanup(); pending = []; full = true; dirty.clear(); shallow.clear(); interactions.clear(); stylesheetState = stylesheetSignature(); observe(); publish(); return;
    }
    full = false; dirty.clear(); shallow.clear();
    // Reads precede all writes; unchanged parents supply cached native colors.
    // Native detection uses a full restoration, without per-element layouts.
    for (const e of elements) {
      const cs = getComputedStyle(e);
      const native = scanAll ? { color: cs.color, webkitTextFillColor: cs.webkitTextFillColor, backgroundColor: cs.backgroundColor } : originalColors(e, cs);
      const data = planStyle(cs, inheritedSurfaces(e), e === document.documentElement, native);
      surfaceCache.set(e, data.surfaces);
      const r = record(e);
      selected.set(e, r);
      r.nativeColors = native;
      r.plan = data.plan; r.pseudo = []; r.interactionRules = null;
      for (const pseudo of ['::before', '::after', ...(['INPUT', 'TEXTAREA'].includes(e.tagName) ? ['::placeholder'] : [])]) {
        const pcs = getComputedStyle(e, pseudo);
        if (pseudo !== '::placeholder' && (pcs.content === 'none' || pcs.content === 'normal')) continue;
        const pseudoNative = scanAll ? { color: pcs.color, webkitTextFillColor: pcs.webkitTextFillColor, backgroundColor: pcs.backgroundColor } : originalColors(e, pcs);
        const pd = planStyle(pcs, data.surfaces, false, pseudoNative);
        if (pseudo === '::placeholder') { pd.plan.opacity = '1'; pd.plan.color = C.css(C.foreground(color(pcs.color) || [160, 160, 160, 1], data.surfaces, config.contrast, config.temperature)); }
        r.pseudo.push({ pseudo, plan: pd.plan });
      }
    }
    for (const [e, r] of selected) if (e.isConnected) apply(e, r);
    updateSheets();
    paintInteractions();
    guard();
    if (scanAll) stylesheetState = stylesheetSignature();
    observe(); publish();
    if (pending.length) timer = setTimeout(run, 16);
  }
  function schedule(forceFull = false) {
    if (forceFull) full = true;
    if (timer || !ready || stopped) return;
    timer = setTimeout(run, Math.max(70, 280 - (performance.now() - lastRun)));
  }
  async function refresh() {
    const version = ++refreshVersion;
    try {
      const ctx = await chrome.runtime.sendMessage({ type: 'AD_CONTEXT' });
      if (version !== refreshVersion) return;
      const next = C.settings(ctx.settings), nextHost = ctx.hostname || hostname, nextNative = ctx.topNative === true;
      if (ready && nextHost === hostname && nextNative === inheritedNative && JSON.stringify(next) === JSON.stringify(config)) return;
      config = next; hostname = nextHost;
      themePalette = C.palette(config.temperature);
      inheritedNative = nextNative;
      ready = true;
      observer.disconnect();
      if (config.enabled && config.mode !== 'off' && (state !== 'native' || config.mode === 'on')) { guard(); shield(); }
      else { removeGuard(); observe(); }
      schedule(true);
    } catch {
      if (version !== refreshVersion) return;
      stopped = true; observer.disconnect(); clearTimeout(timer); removeGuard(); suspend(); cleanup();
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.type === 'AD_GET_STATUS' && (!message.frameUrl || message.frameUrl === location.href)) reply({ state, reason, hostname, config, siteBackground, elements: records.size });
    if (message.type === 'AD_RESCAN') { nativeDecision = null; schedule(true); reply({ ok: true }); }
    if (message.type === 'AD_TOP_NATIVE' && window !== window.top) { inheritedNative = message.native; schedule(true); }
  });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.preferences) refresh(); });
  document.addEventListener('DOMContentLoaded', () => schedule(true), { once: true });
  window.addEventListener('load', () => schedule(true), { once: true });
  window.addEventListener('resize', () => schedule(true), { passive: true });
  window.addEventListener('pageshow', () => refresh());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { nativeDecision = null; schedule(true); });
  document.addEventListener('transitionend', e => { if (e.target === document.documentElement || e.target === document.body) schedule(true); }, true);
  for (const event of ['pointerover', 'pointerout', 'focusin', 'focusout']) document.addEventListener(event, e => {
    const target = eventTarget(e);
    if (!(target instanceof Element) || target === document.documentElement || target === document.body) return;
    // Media also bubble pointer events; inspect their painted ancestors without
    // restoring/writing those containers or visiting their entire subtrees.
    for (let p = target; p && p !== document.documentElement && p !== document.body; p = parent(p)) if (records.has(p)) interactions.add(p);
    schedule();
  }, { passive: true, capture: true });
  document.addEventListener('change', e => {
    if (!(e.target instanceof Element) || excluded.has(e.target.tagName)) return;
    dirty.add(e.target); schedule();
  }, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(true); });
  function editing(e) {
    const target = eventTarget(e);
    if (!(target instanceof Element)) return;
    if (target.isContentEditable || target.tagName === 'TEXTAREA' ||
      (target.tagName === 'INPUT' && ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(target.type))) { editDeadline = performance.now() + 180; return true; }
    return false;
  }
  for (const event of ['input', 'compositionupdate']) document.addEventListener(event, editing, {capture:true,passive:true});
  document.addEventListener('compositionstart', e => { if (editing(e)) composing = true; }, {capture:true,passive:true});
  document.addEventListener('compositionend', e => { composing = false; editing(e); }, {capture:true,passive:true});
  document.addEventListener('keydown', e => {
    if (e.isComposing || e.key.length === 1 || ['Backspace', 'Delete'].includes(e.key)) editing(e);
  }, {capture:true,passive:true});
  function stylesheetSignature() {
    const parts = [];
    for (const root of roots) for (const sheet of [...(root.styleSheets || []), ...(root.adoptedStyleSheets || [])]) {
      if (sheet.ownerNode?.hasAttribute('data-ad-sheet')) continue;
      parts.push(sheet.href || '', String(sheet.disabled), sheet.media.mediaText);
      try { for (const rule of sheet.cssRules) parts.push(rule.cssText); } catch { /* Cross-origin rules are protected. */ }
    }
    return parts.join('\n');
  }
  let stylesheetState = stylesheetSignature();
  // Poll read-only CSSOM state, rather than rewriting the entire DOM every five
  // seconds. Late open shadow roots are discovered without touching their host.
  setInterval(() => {
    if (document.hidden || stopped) return;
    const next = stylesheetSignature();
    if (next !== stylesheetState) { stylesheetState = next; schedule(true); }
    for (const root of [...roots]) for (const e of root.querySelectorAll('*')) {
      if (e.shadowRoot && !roots.has(e.shadowRoot)) { roots.add(e.shadowRoot); dirty.add(e); schedule(); }
    }
    if (state === 'native' || state === 'off') schedule();
  }, 5000);
  // Apply a fallback before any asynchronous message/storage round trip. A
  // direct local read can release it sooner when the extension is globally OFF.
  guard(); observe();
  chrome.storage.local.get('preferences').then(({ preferences = {} }) => {
    if (ready || stopped) return;
    const initial = C.effective(preferences, window === window.top ? location.hostname : '');
    config = initial; themePalette = C.palette(config.temperature);
    observer.disconnect();
    if (!initial.enabled || initial.mode === 'off') { removeGuard(); suspend(); cleanup(); }
    else guard(initial);
    observe();
  }).catch(() => {});
  refresh();
})();
