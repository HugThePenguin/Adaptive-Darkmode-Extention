import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../extension/core.js';
const C = globalThis.ADCore;

test('malformed storage falls back safely and preserves valid site records', () => {
  for (const value of [null, false, 7, 'invalid', [], { global: null, sites: [] }]) assert.deepEqual(C.effective(value), C.defaults);
  assert.deepEqual(C.settings(null), C.defaults);
  assert.equal(C.settings({ brightness: null }).brightness, 18);
  assert.equal(C.settings({ brightness: '' }).brightness, 18);
  const invalidNumber = { valueOf: null, toString: null };
  assert.deepEqual(C.settings({ brightness: invalidNumber, contrast: invalidNumber, temperature: invalidNumber }), C.defaults);
  const site = { brightness: 24, mode: 'on' };
  const input = { global: { enabled: false }, sites: { valid: site, invalid: null, text: 'bad', array: [] } };
  const safe = C.preferences(input);
  assert.deepEqual(safe.sites, { valid: site });
  assert.equal(C.effective(safe, 'valid').brightness, 24);
  assert.equal(C.effective(safe, 'valid').enabled, false);
  assert.deepEqual(input.sites.invalid, null);
  assert.equal(C.effective({ sites: Object.create({ inherited: { mode: 'off' } }) }, 'inherited').mode, 'auto');
  const special = C.preferences(JSON.parse('{"sites":{"__proto__":{"brightness":26}}}'));
  assert.equal(C.effective(special, '__proto__').brightness, 26);
  assert.equal({}.brightness, undefined);
});

test('settings-page surfaces match website mapping and visible text meets both contrast targets', () => {
  for (const temperature of [-100, -40, 0, 40, 100]) for (const brightness of [10, 18, 28]) for (const contrast of [4.5, 7]) {
    const a = C.appearance({ brightness, temperature, contrast });
    assert.equal(a.bg, C.css(C.background([255,255,255,1],brightness,temperature)));
    for (const role of ['text','muted','accent','native']) for (const surface of ['bg','panel','button','hover']) {
      assert.ok(C.contrast(C.parse(a[role]),C.parse(a[surface])) >= contrast, `${temperature}/${brightness}/${contrast}: ${role} on ${surface}`);
    }
  }
});
test('sRGB colors and alpha compose before measuring contrast', () => {
  assert.deepEqual(C.parse('#abcd'), [170, 187, 204, 221 / 255]);
  assert.deepEqual(C.parse('rgb(100% 0% 0% / 50%)').map(v => Math.round(v * 100) / 100), [255, 0, 0, .5]);
  assert.equal(C.contrast([0, 0, 0, 1], [255, 255, 255, 1]), 21);
  assert.equal(C.contrast([0, 0, 0, 0], [255, 255, 255, 1]), 1);
});
test('ordinary and translucent foregrounds meet the selected target on mapped backgrounds', () => {
  let count = 0;
  for (const temperature of [-100, -50, 0, 50, 100]) for (const brightness of [10, 18, 28]) for (const target of [4.5, 7]) {
    for (const bg of ['#ffffff', '#eeeeee', '#888888', '#ff0000', '#0088ff', '#ffeb00', '#171717', '#222222', '#80808080']) {
      const surface = C.blend(C.background(C.parse(bg), brightness, temperature), C.base(brightness, temperature));
      assert.ok(C.luminance(surface) < .15, bg);
      for (const fg of ['#000000', '#555555', '#cccccc', '#ff0000', '#0088ff', '#ee9900', '#00000044', '#ffffff44']) {
        const mapped = C.foreground(C.parse(fg), surface, target, temperature);
        assert.ok(C.contrast(mapped, surface) >= target, `${fg} on ${bg}: ${C.contrast(mapped, surface)}`);
        count++;
      }
    }
  }
  assert.equal(count, 2160);
});
test('gradient stops are darkened without rewriting URLs or dropping alpha', () => {
  const input = 'url("https://example.test/rgb(1,2,3).png"), linear-gradient(rgb(255, 255, 255), rgba(230, 230, 230, 0.5))';
  const mapped = C.gradient(input, 18);
  assert.equal(mapped.colors.length, 2);
  assert.ok(mapped.image.startsWith('url("https://example.test/rgb(1,2,3).png")'));
  assert.equal(mapped.colors[1][3], .5);
  assert.ok(mapped.colors.every(c => C.luminance(c) < .1));
  const surfaces = mapped.colors.map(c => C.blend(c, C.base(18)));
  assert.ok(surfaces.every(bg => C.contrast(C.foreground(C.parse('#333'), surfaces, 7), bg) >= 7));
});
test('wide-gamut whites and setting validation are supported', () => {
  assert.ok(C.luminance(C.parse('color(display-p3 1 1 1)')) > .99);
  assert.deepEqual(C.settings({ mode: 'invalid', brightness: 100, contrast: 21 }), { enabled: true, mode: 'auto', brightness: 28, contrast: 4.5, temperature: -100, suppressImages: false });
});
test('temperature interpolates through neutral and pane colors remain readable', () => {
  for (const temperature of [-100, -50, 0, 50, 100]) {
    const surface = C.background(C.parse('#fff'), 18, temperature);
    const pane = C.parse(C.palette(temperature).bg);
    if (temperature < 0) { assert.ok(surface[0] > surface[2]); assert.ok(pane[0] > pane[2]); }
    else if (temperature > 0) { assert.ok(surface[0] < surface[2]); assert.ok(pane[0] < pane[2]); }
    else { assert.equal(surface[0], surface[2]); assert.equal(pane[0], pane[2]); }
    const palette = C.palette(temperature);
    for (const role of ['bg', 'panel', 'selected', 'button', 'hover']) assert.ok(C.contrast(C.parse(palette.text), C.parse(palette[role])) >= 4.5, `${temperature}: ${role}`);
    assert.ok(C.contrast(C.parse(palette.muted), C.parse(palette.bg)) >= 4.5);
  }
  assert.equal(C.settings({ brightness: 22, contrast: 7, enabled: false }).temperature, -100);
  assert.equal(C.settings({ temperature: 500 }).temperature, 100);
  assert.equal(C.settings({ temperature: -500 }).temperature, -100);
  assert.equal(C.settings({ temperature: 'invalid' }).temperature, -100);
});
test('neutral light and dark backgrounds and ordinary text use a warm sepia palette', () => {
  for (const bg of ['#ffffff', '#eeeeee', '#171b22', '#222222', '#181818']) {
    const mapped = C.background(C.parse(bg), 18);
    assert.ok(mapped[0] > mapped[1] && mapped[1] > mapped[2], `${bg}: ${mapped}`);
  }
  const surface = C.background(C.parse('#fff'), 18);
  const text = C.foreground(C.parse('#000'), surface);
  assert.ok(text[0] > text[1] && text[1] > text[2]);
  assert.ok(C.contrast(text, surface) >= 4.5);
});
test('site-based panes are slightly brighter and readable on light and dark sites', () => {
 for (const color of ['#171b22','#282016','#000','#fff',...Array.from({length:26},(_,i)=>`rgb(${i*10}, ${i*10}, ${i*10})`)]) {
  const site=C.parse(color);
  for (const temperature of [-100,0,100]) {
   const palette=C.sitePalette(site,temperature), bg=C.parse(palette.bg);
   assert.deepEqual(bg.slice(0,3),site.slice(0,3).map(v=>Math.min(255,v+6)));
   for (const fg of ['text','muted','accent','native']) for (const surface of ['bg','panel','button','selected','hover']) {
    assert.ok(C.contrast(C.parse(palette[fg]),C.parse(palette[surface]))>=4.5,`${color} ${temperature} ${fg} on ${surface}`);
   }
  }
 }
});
