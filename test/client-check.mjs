// Verification harness for the browser half (client.js).
//
// Loads client.js inside a `node:vm` context with hand-rolled browser fakes
// (window/__ModuleLoader__, document, localStorage) and a minimal React fake
// good enough to render the Theme Studio function component, then asserts the
// 0.2.2 override-token contract, the host-config / preset behaviour, the
// removal of all font configuration, the optional card layout, and the
// center content-column width (an inline --dsh-chat-user-width property).
//
// Run: node test/client-check.mjs   (from the workspace root, exits 0 on pass)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = readFileSync(path.join(ROOT, 'client.js'), 'utf8')
const PACKAGE_ID = 'dsh-card-theme'
const STORE_KEY = 'dsh-card-theme:selection'
const CONFIG_ELEMENT_ID = 'dsh-card-theme-config'
const BACKDROP_STYLE_ID = 'dsh-card-theme-backdrop'
const LAYOUT_STYLE_ID = 'dsh-card-theme-layout'
const CARD_ATTRIBUTE = 'data-dsh-card-theme'
const CENTER_TOKEN = '--dsh-chat-user-width'
const CHIP_LABELS = ['DeepSeek 默认', 'Nord', 'Solarized', 'One Dark']

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

const failures = []
let assertionCount = 0

function check(condition, message) {
  assertionCount += 1
  if (!condition) failures.push(message)
}

function checkEqual(actual, expected, message) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  check(a === e, message + ' (expected ' + e + ', got ' + a + ')')
}

// Preset literals keep their authored hex casing (deriveMode's baseFill is the
// raw `cfg.background` when no wallpaper is set, in both halves), so compare
// colour pairs case-insensitively. The 0.2.2 contract only requires strings.
function normalizePair(value) {
  if (value === null || typeof value !== 'object') return value
  const out = {}
  for (const key of Object.keys(value)) {
    out[key] = typeof value[key] === 'string' ? value[key].toLowerCase() : value[key]
  }
  return out
}

function checkPair(actual, expected, message) {
  checkEqual(normalizePair(actual), normalizePair(expected), message)
}

// Mirrors dsh-client-ui-theme validateOverrides: every override value must be a
// { light, dark } pair of non-empty strings; a bare string throws on 0.2.2.
function validateTokens(tokens, label) {
  check(tokens !== null && typeof tokens === 'object' && !Array.isArray(tokens), label + ': override tokens must be an object')
  for (const name of Object.keys(tokens)) {
    const value = tokens[name]
    check(value !== null && typeof value === 'object' && !Array.isArray(value), label + ': token ' + name + ' must be an object pair')
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
    check(typeof value.light === 'string' && value.light.length > 0, label + ': token ' + name + ' light must be a non-empty string')
    check(typeof value.dark === 'string' && value.dark.length > 0, label + ': token ' + name + ' dark must be a non-empty string')
  }
}

// Fonts belong to the platform appearance settings now; the plugin must never
// emit a font-family token in any override layer.
function assertNoFontTokens(tokens, label) {
  for (const name of Object.keys(tokens)) {
    check(!name.startsWith('--dsw-font-family'), label + ': unexpected font token ' + name)
    check(name !== '--ds-font-family-code', label + ': unexpected code-font token ' + name)
  }
}

// ---------------------------------------------------------------------------
// Minimal React fake (createElement + hooks + render walker)
// ---------------------------------------------------------------------------

function createReact() {
  const stores = new Map()
  let currentStore = null
  let touched = new Set()

  function storeFor(component) {
    let store = stores.get(component)
    if (store === undefined) {
      store = {
        index: 0,
        state: new Map(),
        refs: new Map(),
        effects: [],
        prevDeps: new Map(),
      }
      stores.set(component, store)
    }
    return store
  }

  function sameDeps(prev, next) {
    if (!Array.isArray(prev) || !Array.isArray(next) || prev.length !== next.length) return false
    for (let i = 0; i < prev.length; i += 1) {
      if (!Object.is(prev[i], next[i])) return false
    }
    return true
  }

  const api = {
    createElement(type, props, ...children) {
      const nextProps = props ? { ...props } : {}
      nextProps.children = children
      return { type, props: nextProps }
    },
    useState(initialValue) {
      const store = currentStore
      const slot = store.index
      store.index += 1
      if (!store.state.has(slot)) {
        store.state.set(slot, typeof initialValue === 'function' ? initialValue() : initialValue)
      }
      const set = (next) => {
        const value = typeof next === 'function' ? next(store.state.get(slot)) : next
        store.state.set(slot, value)
      }
      return [store.state.get(slot), set]
    },
    useEffect(effect, deps) {
      const store = currentStore
      const slot = store.index
      store.index += 1
      store.effects.push({ slot, effect, deps })
    },
    useRef(initialValue) {
      const store = currentStore
      const slot = store.index
      store.index += 1
      if (!store.refs.has(slot)) store.refs.set(slot, { current: initialValue })
      return store.refs.get(slot)
    },
  }

  function beginRender() {
    touched = new Set()
  }

  function expand(node) {
    if (node === null || node === undefined || node === false || node === true) return null
    if (Array.isArray(node)) {
      const list = []
      for (const child of node) {
        const expanded = expand(child)
        if (expanded === null) continue
        if (Array.isArray(expanded)) list.push(...expanded)
        else list.push(expanded)
      }
      return list
    }
    if (typeof node !== 'object') return String(node)
    if (typeof node.type === 'function') {
      const store = storeFor(node.type)
      const previous = currentStore
      store.index = 0
      store.effects = []
      currentStore = store
      touched.add(store)
      let rendered
      try {
        rendered = node.type(node.props || {})
      } finally {
        currentStore = previous
      }
      return expand(rendered)
    }
    const expandedChildren = expand(node.props ? node.props.children : [])
    const children = expandedChildren === null
      ? []
      : Array.isArray(expandedChildren) ? expandedChildren : [expandedChildren]
    return { kind: 'element', type: node.type, props: node.props || {}, children }
  }

  function commitEffects() {
    for (const store of touched) {
      for (const entry of store.effects) {
        const hasPrevious = store.prevDeps.has(entry.slot)
        const previous = store.prevDeps.get(entry.slot)
        const changed = !hasPrevious
          ? true
          : entry.deps === undefined ? true : !sameDeps(previous, entry.deps)
        if (!changed) continue
        store.prevDeps.set(entry.slot, entry.deps)
        entry.effect()
      }
    }
  }

  function mount(component) {
    const root = { type: component, props: { children: [] } }
    return {
      render() {
        beginRender()
        const tree = expand(root)
        commitEffects()
        return tree
      },
    }
  }

  return { api, mount }
}

// ---------------------------------------------------------------------------
// Browser fakes
// ---------------------------------------------------------------------------

function createDocument() {
  const nodes = new Map()
  const headChildren = []
  const attributes = new Map()
  const styleProperties = new Map()

  // documentElement needs the attribute API the card toggle uses
  // (toggleAttribute), plus the inline-style API the center-width property uses
  // (setProperty/removeProperty/getPropertyValue).
  const documentElement = {
    style: {
      setProperty(name, value) {
        styleProperties.set(name, String(value))
      },
      removeProperty(name) {
        styleProperties.delete(name)
      },
      getPropertyValue(name) {
        return styleProperties.has(name) ? styleProperties.get(name) : ''
      },
    },
    toggleAttribute(name, force) {
      const shouldHave = force === undefined ? !attributes.has(name) : Boolean(force)
      if (shouldHave) attributes.set(name, '')
      else attributes.delete(name)
      return shouldHave
    },
    setAttribute(name, value) {
      attributes.set(name, String(value))
    },
    hasAttribute(name) {
      return attributes.has(name)
    },
    removeAttribute(name) {
      attributes.delete(name)
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null
    },
  }

  const document = {
    head: {
      appendChild(node) {
        headChildren.push(node)
        if (node.id) nodes.set(node.id, node)
        return node
      },
    },
    body: {},
    documentElement,
    createElement(tagName) {
      return { tagName, id: '', style: {}, textContent: '', appendChild() {} }
    },
    getElementById(id) {
      return nodes.has(id) ? nodes.get(id) : null
    },
    installConfig(config) {
      const element = {
        tagName: 'script',
        id: CONFIG_ELEMENT_ID,
        type: 'application/json',
        style: {},
        textContent: JSON.stringify(config),
        appendChild() {},
      }
      nodes.set(CONFIG_ELEMENT_ID, element)
      return element
    },
  }

  return { document, headChildren, documentElement }
}

// ---------------------------------------------------------------------------
// Harness: fresh vm context + fake ctx per scenario
// ---------------------------------------------------------------------------

function createHarness(options = {}) {
  const overrides = []
  const registrations = []
  let registration = null

  const sandbox = {}
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  sandbox.__ModuleLoader__ = {
    load(record) {
      registration = record
    },
  }

  const storage = new Map()
  sandbox.localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null
    },
    setItem(key, value) {
      storage.set(key, String(value))
    },
    removeItem(key) {
      storage.delete(key)
    },
  }

  const { document, headChildren, documentElement } = createDocument()
  sandbox.document = document

  if (options.hostConfig !== undefined) {
    sandbox.__DSH_THEME_PLUGIN_CONFIG__ = options.hostConfig
  }
  if (options.domConfig !== undefined) document.installConfig(options.domConfig)
  if (options.storedSelection !== undefined) {
    storage.set(STORE_KEY, JSON.stringify(options.storedSelection))
  }

  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox)

  check(registration !== null, 'client.js registers through window.__ModuleLoader__.load')
  check(registration !== null && registration.id === PACKAGE_ID, 'registration id equals the package name "' + PACKAGE_ID + '"')

  const react = createReact()
  const requireShim = (name) => {
    if (name === 'react') return react.api
    throw new Error('unexpected require("' + name + '") in client.js')
  }
  const clientExports = registration.factory(requireShim)
  check(clientExports !== null && typeof clientExports.apply === 'function', 'factory exports an apply() plugin')

  const slots = {
    inject(name, callback) {
      check(name === 'settings.section', 'injects the settings.section slot (got "' + name + '")')
      check(typeof callback === 'function', 'settings.section injection callback is a function')
      callback()
    },
    register(def, component) {
      registrations.push({ def, component })
      return { dispose() {} }
    },
  }

  const ctx = {
    get(name) {
      return name === 'slots' ? slots : undefined
    },
    theme: {
      overrideTokens(source, tokens) {
        overrides.push({ source, tokens })
        return { dispose() {} }
      },
    },
  }

  clientExports.apply(ctx)

  const harness = {
    sandbox,
    document,
    documentElement,
    headChildren,
    storage,
    overrides,
    registrations,
    ctx,
    cardLayoutEnabled() {
      return documentElement.hasAttribute(CARD_ATTRIBUTE)
    },
    centerWidth() {
      return documentElement.style.getPropertyValue(CENTER_TOKEN)
    },
    centerWidthEnabled() {
      return documentElement.style.getPropertyValue(CENTER_TOKEN) !== ''
    },
    layoutStyleNodes() {
      return headChildren.filter((node) => node.id === LAYOUT_STYLE_ID)
    },
    latest() {
      check(overrides.length > 0, 'ctx.theme.overrideTokens was called')
      return overrides[overrides.length - 1]
    },
    latestTokens() {
      const call = harness.latest()
      return call ? call.tokens : {}
    },
    mount() {
      check(registrations.length === 1, 'exactly one settings.section registration')
      if (registrations.length !== 1) return { tree: null, render: () => null }
      const view = react.mount(registrations[0].component)
      view.tree = view.render()
      return view
    },
  }

  return harness
}

// ---------------------------------------------------------------------------
// Tree helpers (find chip buttons by visible text)
// ---------------------------------------------------------------------------

function collectText(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(collectText).join('')
  if (node.kind === 'element') return node.children.map(collectText).join('')
  return ''
}

function collectButtons(node, out) {
  if (node === null || node === undefined) return out
  if (Array.isArray(node)) {
    for (const child of node) collectButtons(child, out)
    return out
  }
  if (node.kind !== 'element') return out
  if (node.type === 'button') out.push(node)
  for (const child of node.children) collectButtons(child, out)
  return out
}

function findButton(tree, label) {
  const button = collectButtons(tree, []).find((node) => collectText(node) === label)
  return button === undefined ? null : button
}

function collectInputs(node, out) {
  if (node === null || node === undefined) return out
  if (Array.isArray(node)) {
    for (const child of node) collectInputs(child, out)
    return out
  }
  if (node.kind !== 'element') return out
  if (node.type === 'input') out.push(node)
  for (const child of node.children) collectInputs(child, out)
  return out
}

// Ranges are told apart by their min/max: the center-width slider is the only
// one running 400..2400 (image/contrast sliders use 0..100 and 0..60).
function findRangeInput(tree, min, max) {
  const input = collectInputs(tree, []).find(
    (node) => node.props.type === 'range' && node.props.min === min && node.props.max === max,
  )
  return input === undefined ? null : input
}

function clickChip(view, label) {
  const button = findButton(view.tree, label)
  check(button !== null, 'studio renders a chip button labelled "' + label + '"')
  if (button === null) return
  check(typeof button.props.onClick === 'function', 'chip "' + label + '" has an onClick handler')
  if (typeof button.props.onClick === 'function') button.props.onClick()
  view.tree = view.render()
}

// The card layout adds five custom properties on top of the derived palette.
const CARD_TOKENS = [
  '--dsh-card-theme-gap',
  '--dsh-card-theme-radius',
  '--dsh-theme-canvas',
  '--dsh-card-theme-bg',
  '--dsh-card-theme-border',
]
const DERIVED_TOKEN_COUNT = 106
const CARD_TOKEN_COUNT = 5

const NEW_ALIAS_TOKENS = [
  '--dsw-alias-settings-card-fill',
  '--dsw-alias-settings-card-stroke',
  '--dsw-alias-illustration-background',
  '--dsw-alias-illustration-backing',
  '--dsw-alias-illustration-detail',
  '--dsw-alias-illustration-inset',
  '--dsw-alias-illustration-shadow',
  '--dsw-alias-illustration-surface',
  '--dsw-alias-label-shimmer',
  '--dsw-alias-switch-thumb',
  '--dsw-alias-tooltip-key-bg',
  '--dsw-alias-turn-trigger-bg',
  '--dsw-alias-turn-trigger-bg-hover',
  '--dsw-alias-menu-group-header-fill',
  '--dsw-alias-onboarding-card-fill',
  '--dsw-alias-onboarding-secondary-fill',
  '--dsw-alias-onboarding-checkbox-border',
  '--dsw-alias-button-tool-bar-fill',
  '--dsw-alias-button-tool-bar-fill-invisible',
  '--dsw-alias-button-tool-bar-hover',
  '--dsw-alias-toast-label',
]

// ---------------------------------------------------------------------------
// Scenario 1 — no stored selection, no host config: default is nord
// ---------------------------------------------------------------------------

{
  const harness = createHarness()
  check(harness.registrations.length === 1, 'applied plugin registers one settings section')
  if (harness.registrations.length === 1) {
    const def = harness.registrations[0].def
    checkEqual(def.name, 'settings.section', 'registered slot name')
    checkEqual(def.id, 'theme-studio', 'registered slot id')
    checkEqual(def.label, '主题工作室', 'registered slot label')
  }

  const call = harness.latest()
  check(call.source === PACKAGE_ID, 'overrideTokens source is "' + PACKAGE_ID + '"')
  checkPair(
    call.tokens['--dsw-alias-bg-base'],
    { light: '#eceff4', dark: '#2e3440' },
    'default (no config, no storage) bg-base is the nord palette',
  )
  validateTokens(call.tokens, 'default override')
  assertNoFontTokens(call.tokens, 'default override')
  check(
    Object.keys(call.tokens).length === DERIVED_TOKEN_COUNT,
    'default non-stock override carries ' + DERIVED_TOKEN_COUNT + ' tokens and no font tokens (got ' + Object.keys(call.tokens).length + ')',
  )
  check(call.tokens[CENTER_TOKEN] === undefined, 'default override does not carry the content-width property')
  check(call.tokens['--dsh-theme-center-max-width'] === undefined, 'default override does not carry the retired center-width token')

  const layoutNodes = harness.layoutStyleNodes()
  check(layoutNodes.length === 1, 'the card-layout <style> node was appended exactly once')
  if (layoutNodes.length === 1) {
    check(layoutNodes[0].textContent.includes('html[data-dsh-card-theme]'), 'layout stylesheet is keyed on the card attribute')
    check(!layoutNodes[0].textContent.includes('html[data-dsh-theme-center-width]'), 'layout stylesheet no longer carries the retired center-width rule')
    check(!layoutNodes[0].textContent.includes('--dsh-theme-center-max-width'), 'layout stylesheet no longer carries the retired center-width token')
    check(layoutNodes[0].textContent.includes('--dsh-card-theme-gap'), 'layout stylesheet consumes the card tokens')
    check(layoutNodes[0].textContent.includes('--dsh-theme-canvas'), 'layout stylesheet paints the canvas gap')
  }
  check(harness.cardLayoutEnabled() === false, 'card layout is off by default (attribute absent)')
  check(harness.centerWidth() === '', 'content width is 跟随默认 by default (no inline property on <html>)')
  check(harness.centerWidthEnabled() === false, 'content width is off by default')
}

// ---------------------------------------------------------------------------
// Scenario 2 — host config from the 0.2.2 JSON global
// ---------------------------------------------------------------------------

{
  const harness = createHarness({ hostConfig: { preset: 'solarized', light: {}, dark: {} } })
  checkPair(
    harness.latestTokens()['--dsw-alias-bg-base'],
    { light: '#fdf6e3', dark: '#002b36' },
    'global host config preset solarized drives the initial bg-base',
  )
  validateTokens(harness.latestTokens(), 'global-host-config override')
}

// ---------------------------------------------------------------------------
// Scenario 2b — global wins over the older DOM carrier
// ---------------------------------------------------------------------------

{
  const harness = createHarness({
    hostConfig: { preset: 'onedark', light: {}, dark: {} },
    domConfig: { preset: 'solarized', light: {}, dark: {} },
  })
  checkPair(
    harness.latestTokens()['--dsw-alias-bg-base'],
    { light: '#fafafa', dark: '#282c34' },
    'globalThis.__DSH_THEME_PLUGIN_CONFIG__ is read before the DOM carrier',
  )
}

// ---------------------------------------------------------------------------
// Scenario 2c — DOM carrier still works on older shells (no global)
// ---------------------------------------------------------------------------

{
  const harness = createHarness({ domConfig: { preset: 'solarized', light: {}, dark: {} } })
  checkPair(
    harness.latestTokens()['--dsw-alias-bg-base'],
    { light: '#fdf6e3', dark: '#002b36' },
    'DOM carrier is the fallback when the JSON global is absent',
  )
}

// ---------------------------------------------------------------------------
// Scenario 2e — host config carries the card layout switch
// ---------------------------------------------------------------------------

{
  const harness = createHarness({ hostConfig: { preset: 'onedark', cardLayout: true } })
  check(harness.cardLayoutEnabled() === true, 'host config cardLayout:true turns the html attribute on before first paint')
  const tokens = harness.latestTokens()
  for (const name of CARD_TOKENS) {
    check(tokens[name] !== undefined, 'host-config cardLayout override contains ' + name)
  }
  check(
    Object.keys(tokens).length === DERIVED_TOKEN_COUNT + CARD_TOKEN_COUNT,
    'host-config cards-on override carries ' + (DERIVED_TOKEN_COUNT + CARD_TOKEN_COUNT) + ' tokens (got ' + Object.keys(tokens).length + ')',
  )
  validateTokens(tokens, 'host-config cards-on override')
}

// ---------------------------------------------------------------------------
// Scenario 2f — host config without cardLayout keeps the default OFF
// ---------------------------------------------------------------------------

{
  const harness = createHarness({ hostConfig: { preset: 'onedark' } })
  check(harness.cardLayoutEnabled() === false, 'host config without cardLayout leaves the card attribute off')
  for (const name of CARD_TOKENS) {
    check(harness.latestTokens()[name] === undefined, 'cards-off host config omits ' + name)
  }
}

// ---------------------------------------------------------------------------
// Scenario 2g — host config carries the center CONTENT width (inline property)
// ---------------------------------------------------------------------------

{
  const harness = createHarness({ hostConfig: { preset: 'onedark', centerContentWidth: 900 } })
  check(harness.centerWidth() === '900px', 'host config centerContentWidth:900 writes --dsh-chat-user-width on <html>')
  check(harness.centerWidthEnabled() === true, 'host-config content width is live before first paint')
  const tokens = harness.latestTokens()
  check(
    Object.keys(tokens).length === DERIVED_TOKEN_COUNT,
    'content width does not enter the override layer (expected ' + DERIVED_TOKEN_COUNT + ' tokens, got ' + Object.keys(tokens).length + ')',
  )
  check(tokens[CENTER_TOKEN] === undefined, 'overrideTokens never carries --dsh-chat-user-width')
  validateTokens(tokens, 'host-config content-width override')
}

// ---------------------------------------------------------------------------
// Scenario 2h — content width clamps to 400..2400; junk means 跟随默认
// ---------------------------------------------------------------------------

{
  const harness = createHarness({ hostConfig: { preset: 'onedark', centerContentWidth: 3000 } })
  check(harness.centerWidth() === '2400px', 'centerContentWidth above the cap clamps to 2400px')
}

{
  const harness = createHarness({ hostConfig: { preset: 'onedark', centerContentWidth: 100 } })
  check(harness.centerWidth() === '', 'centerContentWidth below 400 means 跟随默认 (property removed)')
  check(harness.centerWidthEnabled() === false, 'centerContentWidth below 400 leaves no inline property')
}

{
  const harness = createHarness({ hostConfig: { preset: 'onedark', centerContentWidth: 'abc' } })
  check(harness.centerWidth() === '', 'a non-numeric centerContentWidth means 跟随默认')
}

{
  const harness = createHarness({ hostConfig: { preset: 'onedark', centerMaxWidth: 900 } })
  check(harness.centerWidth() === '', 'the retired centerMaxWidth config key is ignored (no migration)')
}

{
  const harness = createHarness({ storedSelection: { preset: 'onedark', centerMaxWidth: 900 } })
  check(harness.centerWidth() === '', 'a legacy saved centerMaxWidth key is ignored (no migration)')
}

// ---------------------------------------------------------------------------
// Scenario 2i — the saved selection wins over the host config (both ways)
// ---------------------------------------------------------------------------

{
  const harness = createHarness({
    hostConfig: { preset: 'onedark', centerContentWidth: 900 },
    storedSelection: { preset: 'onedark', centerContentWidth: 720 },
  })
  check(harness.centerWidth() === '720px', 'saved centerContentWidth wins over the host config')
}

{
  const harness = createHarness({
    hostConfig: { preset: 'onedark', centerContentWidth: 900 },
    storedSelection: { preset: 'onedark', centerContentWidth: -1 },
  })
  check(harness.centerWidth() === '', 'a saved 跟随默认 removes the property even when the config sets a width')
  check(harness.centerWidthEnabled() === false, 'a saved 跟随默认 leaves no inline property')
}

// ---------------------------------------------------------------------------
// Scenario 2d — legacy stored ids / custom config preset normalise to nord
// ---------------------------------------------------------------------------

{
  const harness = createHarness({ storedSelection: { preset: 'codex-warm' } })
  checkPair(
    harness.latestTokens()['--dsw-alias-bg-base'],
    { light: '#eceff4', dark: '#2e3440' },
    'a legacy stored preset id falls back to nord',
  )
}

{
  const harness = createHarness({ hostConfig: { preset: 'custom', light: {}, dark: {} } })
  checkPair(
    harness.latestTokens()['--dsw-alias-bg-base'],
    { light: '#eceff4', dark: '#2e3440' },
    'the "custom" config preset falls back to nord',
  )
}

{
  const harness = createHarness({
    hostConfig: { preset: 'solarized', light: {}, dark: {} },
    storedSelection: { preset: 'onedark' },
  })
  checkPair(
    harness.latestTokens()['--dsw-alias-bg-base'],
    { light: '#fafafa', dark: '#282c34' },
    'localStorage selection wins over the host config',
  )
}

// ---------------------------------------------------------------------------
// Scenario 3 — studio chips switch presets and every value is a valid pair
// ---------------------------------------------------------------------------

{
  const harness = createHarness()
  const view = harness.mount()

  // Font controls are gone: the platform Appearance settings own fonts now.
  const studioText = collectText(view.tree)
  check(!studioText.includes('界面字体'), 'studio no longer renders the interface-font row')
  check(!studioText.includes('代码字体'), 'studio no longer renders the code-font row')
  check(studioText.includes('卡片布局'), 'studio renders the card-layout row')

  for (const label of CHIP_LABELS) {
    check(findButton(view.tree, label) !== null, 'studio shows the "' + label + '" preset chip')
  }
  check(findButton(view.tree, '开启') !== null, 'studio renders the card-layout 开启 button')
  check(findButton(view.tree, '关闭') !== null, 'studio renders the card-layout 关闭 button')

  clickChip(view, 'One Dark')
  let tokens = harness.latestTokens()
  checkPair(tokens['--dsw-alias-bg-base'], { light: '#fafafa', dark: '#282c34' }, 'One Dark chip sets bg-base')
  checkPair(tokens['--dsw-alias-brand-primary'], { light: '#4078f2', dark: '#61afef' }, 'One Dark chip sets the brand accent')
  for (const name of NEW_ALIAS_TOKENS) {
    check(tokens[name] !== undefined, 'One Dark override contains new 0.2.2 token ' + name)
  }
  check(
    Object.keys(tokens).length === DERIVED_TOKEN_COUNT,
    'cards-off One Dark override carries ' + DERIVED_TOKEN_COUNT + ' tokens (got ' + Object.keys(tokens).length + ')',
  )
  for (const name of CARD_TOKENS) {
    check(tokens[name] === undefined, 'cards-off One Dark override omits ' + name)
  }
  check(harness.cardLayoutEnabled() === false, 'card attribute stays off while the cards chip is off')
  validateTokens(tokens, 'One Dark chip override')
  assertNoFontTokens(tokens, 'One Dark chip override')

  clickChip(view, '开启')
  tokens = harness.latestTokens()
  check(harness.cardLayoutEnabled() === true, 'clicking 开启 turns the html card attribute on')
  for (const name of CARD_TOKENS) {
    check(tokens[name] !== undefined, 'cards-on override contains ' + name)
  }
  check(
    Object.keys(tokens).length === DERIVED_TOKEN_COUNT + CARD_TOKEN_COUNT,
    'cards-on override carries ' + (DERIVED_TOKEN_COUNT + CARD_TOKEN_COUNT) + ' tokens (got ' + Object.keys(tokens).length + ')',
  )
  checkPair(tokens['--dsh-card-theme-gap'], { light: '8px', dark: '8px' }, 'card gap token pair')
  checkPair(tokens['--dsh-card-theme-radius'], { light: '12px', dark: '12px' }, 'card radius token pair')
  checkPair(tokens['--dsw-alias-bg-base'], { light: '#fafafa', dark: '#282c34' }, 'enabling cards keeps the One Dark bg-base')
  check(tokens['--dsh-theme-canvas'].light !== tokens['--dsw-alias-bg-base'].light, 'card canvas differs from the base surface')
  validateTokens(tokens, 'cards-on override')
  assertNoFontTokens(tokens, 'cards-on override')

  clickChip(view, '关闭')
  tokens = harness.latestTokens()
  check(harness.cardLayoutEnabled() === false, 'clicking 关闭 removes the html card attribute')
  for (const name of CARD_TOKENS) {
    check(tokens[name] === undefined, 'cards-off override after toggling omits ' + name)
  }
  check(
    Object.keys(tokens).length === DERIVED_TOKEN_COUNT,
    'toggling cards off returns to ' + DERIVED_TOKEN_COUNT + ' tokens (got ' + Object.keys(tokens).length + ')',
  )
  validateTokens(tokens, 'cards-off after toggle override')

  clickChip(view, 'Solarized')
  tokens = harness.latestTokens()
  checkPair(tokens['--dsw-alias-bg-base'], { light: '#fdf6e3', dark: '#002b36' }, 'Solarized chip sets bg-base')
  validateTokens(tokens, 'Solarized chip override')

  clickChip(view, 'Nord')
  tokens = harness.latestTokens()
  checkPair(tokens['--dsw-alias-bg-base'], { light: '#eceff4', dark: '#2e3440' }, 'Nord chip sets bg-base')
  validateTokens(tokens, 'Nord chip override')

  clickChip(view, 'DeepSeek 默认')
  tokens = harness.latestTokens()
  checkPair(tokens['--dsw-alias-bg-base'], { light: '#FFFFFF', dark: '#151517' }, 'stock chip keeps the built-in bg-base')
  check(tokens['--dsw-alias-settings-card-fill'] === undefined, 'stock override omits derived settings-card-fill')
  check(tokens['--dsw-alias-menu-group-header-fill'] === undefined, 'stock override omits derived menu-group-header-fill')
  check(
    !Object.keys(tokens).some((name) => name.startsWith('--dsw-alias-illustration-')),
    'stock override omits the derived illustration tokens',
  )
  check(
    Object.keys(tokens).length === 2,
    'cards-off stock override keeps only its two surfaces (got ' + Object.keys(tokens).length + ')',
  )
  for (const name of CARD_TOKENS) {
    check(tokens[name] === undefined, 'cards-off stock override omits ' + name)
  }
  validateTokens(tokens, 'stock chip override')
  assertNoFontTokens(tokens, 'stock chip override')

  // stock + card layout: the built-in surfaces plus the five card tokens.
  clickChip(view, '开启')
  tokens = harness.latestTokens()
  check(harness.cardLayoutEnabled() === true, 'stock preset can also enable the card layout')
  checkPair(tokens['--dsw-alias-bg-base'], { light: '#FFFFFF', dark: '#151517' }, 'cards-on stock override keeps the built-in bg-base')
  check(tokens['--dsw-specific-sidebar-fill'] !== undefined, 'cards-on stock override keeps the sidebar surface token')
  for (const name of CARD_TOKENS) {
    check(tokens[name] !== undefined, 'cards-on stock override contains ' + name)
  }
  check(
    Object.keys(tokens).length === 2 + CARD_TOKEN_COUNT,
    'cards-on stock override carries 2 surfaces + 5 card tokens (got ' + Object.keys(tokens).length + ')',
  )
  validateTokens(tokens, 'stock cards-on override')
  assertNoFontTokens(tokens, 'stock cards-on override')

  // Content-width row: 跟随默认 by default; chips and the slider are live and
  // only move an inline property on <html>, never the override layer.
  const studioWidthText = collectText(view.tree)
  check(studioWidthText.includes('内容区域宽度'), 'studio renders the content-width row')
  check(findButton(view.tree, '跟随默认') !== null, 'studio renders the 跟随默认 button')
  check(findButton(view.tree, '窄 640px') !== null, 'studio renders the 640px preset')
  check(findButton(view.tree, '标准 748px') !== null, 'studio renders the 748px preset')
  check(findButton(view.tree, '宽 920px') !== null, 'studio renders the 920px preset')
  check(findButton(view.tree, '超宽 1200px') !== null, 'studio renders the 1200px preset')

  clickChip(view, '关闭')
  check(harness.centerWidth() === '', 'content width is off while 跟随默认 is selected')
  check(harness.latestTokens()[CENTER_TOKEN] === undefined, '跟随默认 leaves the override layer untouched')

  clickChip(view, '标准 748px')
  tokens = harness.latestTokens()
  check(harness.centerWidth() === '748px', 'clicking 标准 748px sets --dsh-chat-user-width to 748px')
  check(
    Object.keys(tokens).length === 2,
    'stock + content width still carries only the 2 surface tokens (got ' + Object.keys(tokens).length + ')',
  )
  check(tokens[CENTER_TOKEN] === undefined, 'the width property never becomes an override token')
  validateTokens(tokens, 'stock content-width override')

  const slider = findRangeInput(view.tree, 400, 2400)
  check(slider !== null, 'studio renders the content-width range slider (400..2400)')
  if (slider !== null) {
    checkEqual(slider.props.value, 748, 'the range slider reflects the selected 748px')
    slider.props.onChange({ target: { value: '1500' } })
    view.tree = view.render()
  }
  check(harness.centerWidth() === '1500px', 'dragging the slider to 1500 updates --dsh-chat-user-width')
  const sliderAfter = findRangeInput(view.tree, 400, 2400)
  check(sliderAfter !== null && sliderAfter.props.value === 1500, 'the range slider follows the dragged value')

  clickChip(view, '跟随默认')
  tokens = harness.latestTokens()
  check(harness.centerWidth() === '', 'clicking 跟随默认 removes the inline property')
  check(tokens[CENTER_TOKEN] === undefined, '跟随默认 keeps the override layer palette-only')
  check(Object.keys(tokens).length === 2, 'stock 跟随默认 returns to the 2 surface tokens (got ' + Object.keys(tokens).length + ')')

  // Non-stock: the content width rides the inline property, cards still +5 tokens.
  clickChip(view, 'One Dark')
  clickChip(view, '超宽 1200px')
  tokens = harness.latestTokens()
  check(harness.centerWidth() === '1200px', '超宽 1200px sets the inline property on a non-stock palette')
  check(
    Object.keys(tokens).length === DERIVED_TOKEN_COUNT,
    'cards-off + content width carries ' + DERIVED_TOKEN_COUNT + ' palette tokens (got ' + Object.keys(tokens).length + ')',
  )
  check(tokens[CENTER_TOKEN] === undefined, 'content width is not part of the cards-off override')

  clickChip(view, '开启')
  tokens = harness.latestTokens()
  check(harness.cardLayoutEnabled() === true && harness.centerWidth() === '1200px', 'cards and content width can be enabled together')
  for (const name of CARD_TOKENS) {
    check(tokens[name] !== undefined, 'cards + width override contains ' + name)
  }
  check(
    Object.keys(tokens).length === DERIVED_TOKEN_COUNT + CARD_TOKEN_COUNT,
    'cards + content width carries ' + (DERIVED_TOKEN_COUNT + CARD_TOKEN_COUNT) + ' tokens (got ' + Object.keys(tokens).length + ')',
  )
  validateTokens(tokens, 'cards + content width override')

  clickChip(view, '跟随默认')
  tokens = harness.latestTokens()
  check(harness.centerWidth() === '', 'switching back to 跟随默认 removes the property while cards stay on')
  check(
    Object.keys(tokens).length === DERIVED_TOKEN_COUNT + CARD_TOKEN_COUNT,
    'cards-on + 跟随默认 carries ' + (DERIVED_TOKEN_COUNT + CARD_TOKEN_COUNT) + ' tokens (got ' + Object.keys(tokens).length + ')',
  )

  // Every override emitted by the studio must satisfy the 0.2.2 pair contract,
  // contain no font tokens and no center-width property, and the layout
  // stylesheet must still exist once.
  check(harness.overrides.length >= 16, 'studio emitted override calls for the initial paint, chip clicks, layout toggles and width edits')
  for (const call of harness.overrides) {
    check(call.source === PACKAGE_ID, 'all override calls use the plugin source id')
    validateTokens(call.tokens, 'recorded override')
    assertNoFontTokens(call.tokens, 'recorded override')
    check(call.tokens[CENTER_TOKEN] === undefined, 'no override call carries --dsh-chat-user-width')
    check(call.tokens['--dsh-theme-center-max-width'] === undefined, 'no override call carries the retired center token')
  }
  check(harness.layoutStyleNodes().length === 1, 'the card-layout <style> node is still injected exactly once')

  console.log('info: non-stock override tokens = ' + DERIVED_TOKEN_COUNT + ' (cards off) / ' + (DERIVED_TOKEN_COUNT + CARD_TOKEN_COUNT) + ' (cards on); content width is an inline <html> property, never a token')
  console.log('info: new 0.2.2 alias tokens = ' + NEW_ALIAS_TOKENS.length)
}

// ---------------------------------------------------------------------------
// Scenario 4 — background image goes through the backdrop <style> node
// ---------------------------------------------------------------------------

{
  const harness = createHarness({
    hostConfig: {
      preset: 'onedark',
      light: { backgroundImage: 'https://example.com/a.jpg', backgroundImageMask: 70 },
      dark: {},
    },
  })
  const styleNode = harness.headChildren.find((node) => node.id === BACKDROP_STYLE_ID)
  check(styleNode !== undefined, 'a backdrop <style> node was appended to document.head')
  if (styleNode !== undefined) {
    check(styleNode.textContent.includes('background-image'), 'backdrop CSS declares background-image')
    check(styleNode.textContent.includes('https://example.com/a.jpg'), 'backdrop CSS contains the configured image URL')
    check(styleNode.textContent.includes('data-ds-dark-theme'), 'backdrop CSS keeps the dark-mode rule')
  }
  check(harness.layoutStyleNodes().length === 1, 'the wallpaper path still injects the card-layout stylesheet once')
  check(harness.cardLayoutEnabled() === false, 'the wallpaper path leaves the card attribute off')
  const tokens = harness.latestTokens()
  validateTokens(tokens, 'onedark wallpaper override')
  assertNoFontTokens(tokens, 'onedark wallpaper override')
  for (const name of CARD_TOKENS) {
    check(tokens[name] === undefined, 'wallpaper override without cardLayout omits ' + name)
  }
}

// ---------------------------------------------------------------------------
// Source-level regression guards — the v0.5 attribute/token mechanism is gone
// ---------------------------------------------------------------------------

{
  check(!SOURCE.includes('CENTER_WIDTH_CSS'), 'client.js no longer defines CENTER_WIDTH_CSS')
  check(!SOURCE.includes('centerMaxWidth'), 'client.js no longer mentions centerMaxWidth')
  check(!SOURCE.includes('data-dsh-theme-center-width'), 'client.js no longer mentions the retired center-width attribute')
  check(!SOURCE.includes('--dsh-theme-center-max-width'), 'client.js no longer mentions the retired center-width token')
  check(SOURCE.includes("const CENTER_TOKEN = '--dsh-chat-user-width'"), 'client.js publishes the platform --dsh-chat-user-width property')
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error('FAIL - ' + failures.length + ' of ' + assertionCount + ' assertions failed:')
  for (const failure of failures) console.error('  - ' + failure)
  process.exit(1)
}

console.log('ok - ' + assertionCount + ' assertions passed')
process.exit(0)
