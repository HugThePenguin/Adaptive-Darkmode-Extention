import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source = await fs.readFile(new URL('../extension/content.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('  function collect('), source.indexOf('  function inheritedSurfaces('));
const node = tagName => ({ tagName, nodeType: 1, children: [], namespaceURI: 'http://www.w3.org/1999/xhtml' });
test('actual traversal handles 10,000 nested nodes beyond JS recursion depth', () => {
  const root = node('MAIN'); let current = root;
  for (let i = 0; i < 10000; i++) { const child = node('DIV'); current.children.push(child); current = child; }
  const scope = { C: { mediaSelector: '' }, mediaOwner: () => null, roots: new Set(), excluded: new Set(), output: [], root, seen: new Set() };
  vm.runInNewContext(`${code}\ncollect(root,output,seen)`, scope);
  assert.equal(scope.output.length, 10001); assert.equal(scope.output[0], root); assert.equal(scope.output.at(-1), current);
});
test('traversal keeps parent-first order and discovers open shadow roots while skipping media', () => {
  const root = node('DIV'), light = node('P'), shadow = { children: [node('SPAN')] }, image = node('IMG');
  image.children.push(node('DIV')); root.children.push(light, image); root.shadowRoot = shadow;
  const scope = { C: { mediaSelector: '' }, mediaOwner: () => null, roots: new Set(), excluded: new Set(['IMG']), output: [], root, seen: new Set() };
  vm.runInNewContext(`${code}\ncollect(root,output,seen)`, scope);
  assert.deepEqual(Array.from(scope.output, n => n.tagName), ['DIV', 'SPAN', 'P']); assert.ok(scope.roots.has(shadow));
});
