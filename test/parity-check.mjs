// Cross-file parity check: the host half (index.js) and the browser half
// (client.js) each carry a copy of the presets, of the token derivation engine
// and of the card-layout stylesheet, because the browser bundle cannot import
// the host module. This test fails as soon as the two copies drift apart.
//
// Run: node test/parity-check.mjs   (from the workspace root, exits 0 on pass)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8')

/** Extract the balanced `{...}` block that starts at the first `{` after `needle`. */
function blockOf(source, needle) {
  const start = source.indexOf(needle)
  assert.notEqual(start, -1, 'missing "' + needle + '"')
  let index = source.indexOf('{', start)
  let depth = 0
  for (; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(source.indexOf('{', start), index + 1)
    }
  }
  throw new Error('unbalanced braces after "' + needle + '"')
}

/** Evaluate one object literal copied out of a bundle. */
function objectOf(source, needle) {
  // eslint-disable-next-line no-eval -- trusted literals from this repository
  return eval('(' + blockOf(source, needle) + ')')
}

/** Parse `'--token': expression,` entries of the deriveMode colors object. */
function colorMap(source) {
  const block = blockOf(source, 'const colors = {')
  const map = new Map()
  const pattern = /'(--dsw-[a-z0-9-]+)':\s*([^,\n]+(?:\n[^,\n]+)*),/g
  let match
  while ((match = pattern.exec(block)) !== null) map.set(match[1], match[2].replace(/\s+/g, ' ').trim())
  return map
}

/** Parse every `'--dsh-theme-token': expression,` pair in the whole file. */
function themeTokenMap(source) {
  const map = new Map()
  const pattern = /'(--dsh-theme-[a-z0-9-]+)':\s*([^,\n]+(?:\n[^,\n]+)*),/g
  let match
  while ((match = pattern.exec(source)) !== null) map.set(match[1], match[2].replace(/\s+/g, ' ').trim())
  return map
}

/** Read a shared layout stylesheet (one template literal in each half). */
function templateOf(source, name) {
  const needle = 'const ' + name + ' = `'
  const start = source.indexOf(needle)
  assert.notEqual(start, -1, 'missing "' + needle + '"')
  const from = source.indexOf('`', start) + 1
  const to = source.indexOf('`', from)
  assert.notEqual(to, -1, 'unterminated ' + name + ' template literal')
  return source.slice(from, to)
}

function cardLayoutCss(source) {
  return templateOf(source, 'CARD_LAYOUT_CSS')
}

const host = read('index.js')
const client = read('client.js')

// ---------------------------------------------------------------------------
// Fonts are gone from both halves.
// ---------------------------------------------------------------------------
for (const [name, source] of [['index.js', host], ['client.js', client]]) {
  for (const needle of ['uiFont', 'codeFont', 'UI_FONTS', 'CODE_FONTS', '--dsw-font-family', '--ds-font-family-code']) {
    assert.equal(source.includes(needle), false, name + ' still mentions ' + needle)
  }
}

// ---------------------------------------------------------------------------
// Presets: same ids, labels and per-mode values in both halves; no font fields.
// ---------------------------------------------------------------------------
const hostPresets = objectOf(host, 'const presets = {')
const clientPresets = objectOf(client, 'const presets = {')

const presetKeys = ['stock', 'nord', 'solarized', 'onedark']
assert.deepEqual(Object.keys(hostPresets), presetKeys, 'host preset keys')
assert.deepEqual(Object.keys(clientPresets), presetKeys, 'client preset keys')

const FIELDS = ['accent', 'background', 'foreground', 'translucentSidebar', 'contrast']
for (const id of presetKeys) {
  assert.equal(hostPresets[id].label, clientPresets[id].label, 'label of ' + id)
  for (const mode of ['light', 'dark']) {
    assert.deepEqual(
      Object.keys(hostPresets[id][mode]).sort(),
      [...FIELDS].sort(),
      'preset ' + id + '.' + mode + ' fields',
    )
    for (const field of FIELDS) {
      assert.equal(
        hostPresets[id][mode][field],
        clientPresets[id][mode][field],
        'preset ' + id + '.' + mode + '.' + field,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Token engine: same base palette and same conditional card tokens.
// ---------------------------------------------------------------------------
const hostColors = colorMap(host)
const clientColors = colorMap(client)
assert.ok(hostColors.size > 90, 'host derives a full palette (got ' + hostColors.size + ')')
assert.equal(hostColors.size, clientColors.size, 'derived token count')
for (const [name, value] of hostColors) {
  assert.equal(clientColors.get(name), value, 'derived token ' + name)
}

const hostCardTokens = themeTokenMap(host)
const clientCardTokens = themeTokenMap(client)
const CARD_TOKEN_NAMES = [
  '--dsh-card-theme-gap',
  '--dsh-card-theme-radius',
  '--dsh-theme-canvas',
  '--dsh-card-theme-bg',
  '--dsh-card-theme-border',
]
assert.deepEqual([...hostCardTokens.keys()].sort(), [...CARD_TOKEN_NAMES].sort(), 'host card token names')
assert.deepEqual([...clientCardTokens.keys()].sort(), [...hostCardTokens.keys()].sort(), 'card token names')
for (const [name, value] of hostCardTokens) {
  assert.equal(clientCardTokens.get(name), value, 'card token formula ' + name)
}

// ---------------------------------------------------------------------------
// Card layout stylesheet is byte-identical in both halves.
// ---------------------------------------------------------------------------
const hostCss = cardLayoutCss(host)
const clientCss = cardLayoutCss(client)
assert.ok(hostCss.includes('html[data-dsh-card-theme]'), 'host card stylesheet is attribute-gated')
assert.ok(hostCss.includes('data-sidebar-right-panel'), 'host card stylesheet covers the right panel')
assert.equal(clientCss, hostCss, 'CARD_LAYOUT_CSS is identical in index.js and client.js')

// ---------------------------------------------------------------------------
// Center content width: both halves drive the platform's own
// --dsh-chat-user-width custom property, and the retired v0.5 mechanism
// (attribute + stylesheet + token) is gone from both.
// ---------------------------------------------------------------------------
const CENTER_TOKEN_LINE = "const CENTER_TOKEN = '--dsh-chat-user-width'"
assert.ok(host.includes(CENTER_TOKEN_LINE), 'index.js shares the CENTER_TOKEN constant')
assert.ok(client.includes(CENTER_TOKEN_LINE), 'client.js shares the CENTER_TOKEN constant')
for (const [name, source] of [['index.js', host], ['client.js', client]]) {
  for (const needle of ['CENTER_WIDTH_CSS', 'CENTER_ATTRIBUTE', 'data-dsh-theme-center-width', '--dsh-theme-center-max-width', 'centerMaxWidth']) {
    assert.equal(source.includes(needle), false, name + ' still carries retired center mechanism: ' + needle)
  }
  // Same clamp helper semantics (identical body after whitespace collapse).
  const body = (s) => {
    const i = s.indexOf('function centerWidthValue(raw)')
    assert.notEqual(i, -1, name + ' has centerWidthValue')
    let depth = 0
    let j = s.indexOf('{', i)
    for (let k = j; k < s.length; k += 1) {
      if (s[k] === '{') depth += 1
      else if (s[k] === '}') {
        depth -= 1
        if (depth === 0) return s.slice(j, k + 1).replace(/\s+/g, ' ')
      }
    }
    throw new Error('unbalanced centerWidthValue in ' + name)
  }
  assert.equal(body(client), body(host), name + ' centerWidthValue matches index.js')
}

console.log('ok - fonts removed from both halves')
console.log('ok - presets identical across index.js and client.js (' + presetKeys.length + ')')
console.log('ok - derived color maps identical (' + hostColors.size + ' tokens)')
console.log('ok - conditional card tokens identical (' + hostCardTokens.size + ')')
console.log('ok - CARD_LAYOUT_CSS identical (' + hostCss.length + ' chars)')
console.log('ok - center content width uses --dsh-chat-user-width in both halves')
console.log('parity checks passed')
