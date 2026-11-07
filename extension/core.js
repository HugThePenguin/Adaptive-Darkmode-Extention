/* Shared pure color operations. No network access or page text collection. */
(() => {
  'use strict';
  const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
  const defaults = Object.freeze({ enabled: true, mode: 'auto', contrast: 4.5, brightness: 18, temperature: -100, suppressImages: false });
  const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const number = (value, fallback) => (typeof value === 'number' || (typeof value === 'string' && value.trim())) && Number.isFinite(Number(value)) ? Number(value) : fallback;
  function settings(value = {}) {
    if (!isRecord(value)) value = {};
    const contrast = number(value.contrast, 4.5);
    return {
      enabled: value.enabled !== false,
      mode: ['auto', 'on', 'off'].includes(value.mode) ? value.mode : 'auto',
      contrast: [4.5, 7].includes(contrast) ? contrast : 4.5,
      brightness: clamp(number(value.brightness, 18), 10, 28),
      temperature: clamp(number(value.temperature, defaults.temperature), -100, 100),
      suppressImages: value.suppressImages === true
    };
  }
  function preferences(value = {}) {
    if (!isRecord(value)) value = {};
    return { global: isRecord(value.global) ? value.global : {},
      sites: Object.fromEntries(Object.entries(isRecord(value.sites) ? value.sites : {}).filter(([, site]) => isRecord(site))) };
  }
  // The global enable switch is a master switch. Site records contain only
  // appearance overrides; fields absent from a record follow the defaults.
  function effective(value = {}, hostname = '') {
    // A lookup stays O(1) regardless of how many site records are stored.
    const global = isRecord(value?.global) ? value.global : {};
    const sites = isRecord(value?.sites) ? value.sites : {};
    const site = Object.hasOwn(sites, hostname) && isRecord(sites[hostname]) ? sites[hostname] : {};
    return settings({ ...global, ...site, enabled: global.enabled });
  }
  function appearance(value = {}) {
    const config = settings(value), result = palette(config.temperature);
    const surface = level => parse(css(background([level, level, level, 1], config.brightness, config.temperature)));
    const surfaces = [surface(255), surface(238), surface(215), surface(200)];
    result.bg = css(surfaces[0]); result.panel = css(surfaces[1]);
    result.button = css(surfaces[2]); result.hover = result.selected = css(surfaces[3]);
    for (const role of ['text', 'muted', 'accent', 'native']) {
      const seed = parse(result[role]);
      // Secondary text demonstrates the selected contrast threshold, instead
      // of starting bright enough that both targets would look identical.
      if (role === 'muted') for (let i = 0; i < 3; i++) seed[i] *= .8;
      result[role] = css(foreground(seed, surfaces, config.contrast, config.temperature));
    }
    return result;
  }
  // Fallback rules cover new content until inline plans are ready. Photos,
  // media, SVG artwork and native select options stay untouched.
  const loadingCSS = token => ['loading', 'active'].map(phase => {
    const root = `html[data-ad-phase="${phase}"]`;
    return `${root}{background-color:var(--ad-loading-bg,#1a1612)!important;color-scheme:dark!important}` +
      `${root} body:not([data-ad-rendered="${token}"]),${root} body :where(*):not([data-ad-rendered="${token}"]):not(img,picture,video,audio,canvas,svg,svg *,iframe,object,embed,option,optgroup){background-color:var(--ad-loading-bg,#1a1612)!important;background-image:none!important;color:var(--ad-loading-fg,#eee1cc)!important;-webkit-text-fill-color:var(--ad-loading-fg,#eee1cc)!important}`;
  }).join('\n');
  function parse(input) {
    if (!input) return null;
    if (input === 'transparent') return [0, 0, 0, 0];
    const hex = input.match(/^#([a-f\d]{3,8})$/i);
    if (hex) {
      let s = hex[1];
      if (s.length === 3 || s.length === 4) s = [...s].map(c => c + c).join('');
      if (s.length !== 6 && s.length !== 8) return null;
      return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16), s.length === 8 ? parseInt(s.slice(6), 16) / 255 : 1];
    }
    const rgb = input.match(/^rgba?\(([^)]+)\)$/i);
    if (rgb) {
      const parts = rgb[1].trim().split(/\s*[,/]\s*|\s+/);
      if (parts.length < 3) return null;
      const numbers = parts.map((p, i) => parseFloat(p) * (p.includes('%') ? (i < 3 ? 2.55 : .01) : 1));
      if (numbers.some(n => !Number.isFinite(n))) return null;
      return [clamp(numbers[0], 0, 255), clamp(numbers[1], 0, 255), clamp(numbers[2], 0, 255), clamp(numbers[3] ?? 1)];
    }
    // Chromium may retain wide-gamut colors in computed styles. Convert the two
    // common RGB spaces to sRGB rather than silently leaving a white panel.
    const wide = input.match(/^color\((srgb|display-p3)\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)(?:\s*\/\s*([\d.]+))?\)$/i);
    if (wide) {
      let channels = wide.slice(2, 5).map(Number);
      if (wide[1] === 'display-p3') {
        const lin = channels.map(linear);
        channels = [1.224745 * lin[0] - .224904 * lin[1], -.042058 * lin[0] + 1.042081 * lin[1], -.019642 * lin[0] - .078655 * lin[1] + 1.098537 * lin[2]].map(encode);
      }
      return [...channels.map(v => clamp(v) * 255), clamp(Number(wide[5] ?? 1))];
    }
    return null;
  }
  function linear(v) { return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }
  function encode(v) { return v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055; }
  function luminance(c) { return c.slice(0, 3).map(v => linear(v / 255)).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0); }
  function blend(fg, bg) { const a = fg[3] ?? 1; return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a)).concat(1); }
  function contrast(fg, bg) { const a = luminance(blend(fg, bg)), b = luminance(bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); }
  function css(c) { return `rgba(${c.slice(0, 3).map(v => Math.round(clamp(v, 0, 255))).join(', ')}, ${Math.round(clamp(c[3] ?? 1) * 1000) / 1000})`; }
  function tone(warm, neutral, cool, temperature = defaults.temperature) {
    const t = clamp(Number.isFinite(Number(temperature)) ? Number(temperature) : defaults.temperature, -100, 100) / 100;
    const end = t < 0 ? warm : cool;
    return neutral.map((v, i) => v + (end[i] - v) * Math.abs(t));
  }
  const base = (brightness, temperature = defaults.temperature) => tone([8, 4, 0], [0, 0, 0], [0, 3, 8], temperature).map(v => brightness + v).concat(1);
  function palette(temperature = defaults.temperature) {
    const role = (warm, neutral, cool) => css(tone(warm, neutral, cool, temperature).concat(1));
    return {
      bg: role([32,26,20], [26,26,26], [20,26,34]),
      panel: role([43,35,27], [35,35,35], [28,36,48]),
      text: role([238,225,204], [232,232,232], [222,231,244]),
      muted: role([204,185,155], [190,190,190], [181,195,216]),
      border: role([90,72,53], [75,75,75], [64,79,100]),
      accent: role([231,187,120], [205,205,205], [155,190,243]),
      selected: role([110,76,40], [80,80,80], [51,79,118]),
      button: role([72,52,34], [55,55,55], [37,54,78]),
      hover: role([93,66,43], [73,73,73], [48,71,106]),
      switch: role([165,118,62], [130,130,130], [88,125,190]),
      native: role([198,207,151], [182,209,183], [151,210,187]),
      pageBorder: role([77,66,51], [72,72,72], [65,73,85]),
      scrollbar: role([117,99,77], [104,104,104], [89,99,114])
    };
  }
  function sitePalette(siteBackground, temperature = defaults.temperature) {
    const result = palette(temperature);
    const bg = siteBackground.slice(0, 3).map(v => clamp(v + 6, 0, 255)).concat(1);
    const white = [255, 255, 255, 1], black = [0, 0, 0, 1];
    const dark = contrast(white, bg) >= contrast(black, bg);
    const shift = amount => bg.slice(0, 3).map(v => clamp(v + (dark ? amount : -amount), 0, 255)).concat(1);
    const preferred = dark ? white : black;
    const surface = amount => {
      // Mid-gray sites leave little room for brighter cards and readable text.
      for (let n = amount; n >= 0; n--) {
        const candidate = shift(n);
        if (contrast(preferred, candidate) >= 4.5) return candidate;
      }
      return bg;
    };
    const surfaces = [bg, surface(8), surface(14), surface(20)];
    const minimum = c => Math.min(...surfaces.map(s => contrast(c, s)));
    const endpoint = minimum(white) >= minimum(black) ? white : black;
    const readable = (value, target = 4.5) => {
      const seed = parse(value);
      for (let step = 0; step <= 100; step++) {
        const c = seed.slice(0, 3).map((v, i) => Math.round(v + (endpoint[i] - v) * step / 100)).concat(1);
        if (minimum(c) >= target) return css(c);
      }
      return css(endpoint);
    };
    result.bg = css(bg); result.panel = css(surfaces[1]);
    result.button = result.selected = css(surfaces[2]); result.hover = css(surfaces[3]);
    result.border = css(shift(38));
    for (const role of ['text', 'muted', 'accent', 'native']) result[role] = readable(result[role]);
    result.switch = css(shift(55));
    return result;
  }
  function background(c, brightness = 18, temperature = defaults.temperature) {
    if (!c || c[3] === 0) return c;
    const l = luminance(c);
    const spread = Math.max(...c.slice(0, 3)) - Math.min(...c.slice(0, 3));
    if (l < .075) {
      // A light page can contain already-dark panels. Apply the chosen tone too,
      // while native dark pages are excluded by the content script altogether.
      const level = c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
      const tint = spread > 40 ? .12 : 0;
      const offsets = tone([4, 0, -5], [0, 0, 0], [-4, 0, 5], temperature);
      return offsets.map((offset, i) => clamp(level + offset + (c[i] - level) * tint, 0, 82)).concat(c[3]);
    }
    // Preserve a subtle separation between white cards and gray containers.
    const neutral = base(brightness + (1 - l) * 16 + 5, temperature);
    const tint = spread > 24 ? .17 : .025;
    return neutral.slice(0, 3).map((v, i) => clamp(v + (c[i] - 128) * tint, 0, 82)).concat(c[3]);
  }
  function foreground(c, surfaces, target = 4.5, temperature = defaults.temperature) {
    if (!c || c[3] === 0) return c;
    const bgs = Array.isArray(surfaces[0]) ? surfaces : [surfaces];
    const works = color => bgs.every(bg => contrast(color, bg) >= target);
    const max = Math.max(...c.slice(0, 3)), min = Math.min(...c.slice(0, 3));
    const neutral = max - min < 28;
    const offsets = tone([6, 0, -10], [0, 0, 0], [-6, 0, 10], temperature);
    const themed = neutral ? c.slice(0, 3).map((v, i) => clamp(v + offsets[i], 0, 255)).concat(c[3]) : c;
    if (works(themed)) return themed;
    const seed = neutral ? tone([239,225,203], [230,230,230], [214,227,242], temperature).concat(1) : c.slice(0, 3).concat(1);
    // Raise alpha as well: translucent gray text must become readable too.
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      const candidate = seed.slice(0, 3).map(v => Math.round(v + (255 - v) * t)).concat(1);
      if (works(candidate)) return candidate;
    }
    // Image pixels cannot be inferred from CSS; caller documents this limit.
    return [255, 255, 255, 1];
  }
  function gradient(image, brightness, temperature = defaults.temperature) {
    if (!image.includes('gradient(')) return { image, colors: [] };
    const colors = [];
    // Computed gradients serialize stops to rgb()/rgba()/color(); quoted URLs
    // are matched as a whole so filenames containing rgb(...) are untouched.
    const mapped = image.replace(/url\((?:"[^"]*"|'[^']*'|[^)]*)\)|(?:rgba?\([^)]*\)|color\([^)]*\)|#[a-f\d]{3,8}\b)/gi, token => {
      if (token.startsWith('url(')) return token;
      const c = parse(token);
      if (!c) return token;
      const dark = background(c, brightness, temperature);
      colors.push(dark);
      return css(dark);
    });
    return { image: mapped, colors };
  }
  globalThis.ADCore = Object.freeze({ defaults, settings, preferences, effective, appearance, loadingCSS, parse, luminance, blend, contrast, css, tone, palette, sitePalette, base, background, foreground, gradient });
})();
