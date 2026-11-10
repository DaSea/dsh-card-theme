// dsh-card-theme v0.6 — 作者：DaSea · 2026-11-10
// Host 半端：优先通过 webServer.collectIndexInjections 的结构化行
// （`webserver/index-inject`）注入主题 <style>、配置全局变量与首屏布局引导脚本
// （卡片布局、内容列宽度）；0.2.2 桌面端的页面启动只消费这份行表，tapIndex
// 不会被应用，所以旧 shell 回退到 tapIndex + 内联 JSON 载体。字体不再由插件配置
// （平台 Appearance 已提供字体设置）。内容列宽度经平台自身的
// --dsh-chat-user-width 变量实现（document 级下发，平台原生拖拽在元素级仍可
// 覆盖）；卡片布局默认关闭，内容列宽度默认不限，宿主配置开启时在首屏即生效。
// 0.2.x 的 web-shell 不再把 cordis 配置传给 client 插件，client 半端改为从全局
// 变量（旧 shell 为 JSON 载体）读取宿主配置。
import z from '@deepseek-ai/schemastery'

export const name = 'card-theme-plugin'

// ---------------------------------------------------------------------------
// Color math (no external deps)
// ---------------------------------------------------------------------------

function parseColor(input) {
  const c = String(input).trim()
  if (c.startsWith('#')) {
    const hex = c.slice(1)
    if (hex.length === 3) {
      const [r, g, b] = hex.split('').map((h) => parseInt(h + h, 16))
      return { r, g, b, a: 1 }
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1,
      }
    }
    if (hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16) / 255,
      }
    }
  }
  const m = c.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/)
  if (m) {
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] }
  }
  throw new Error('card-theme-plugin: unsupported color format "' + c + '"')
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)) }

function round(c) {
  return { r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b), a: c.a ?? 1 }
}

function formatHex(c) {
  const parsed = typeof c === 'string' ? parseColor(c) : c
  const x = round(parsed)
  const a = x.a ?? 1
  if (a !== 1) return 'rgba(' + x.r + ', ' + x.g + ', ' + x.b + ', ' + a.toFixed(3) + ')'
  return '#' + [x.r, x.g, x.b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

function mix(a, b, t) {
  const A = parseColor(a); const B = parseColor(b)
  const s = clamp(t, 0, 1)
  return formatHex({
    r: A.r + (B.r - A.r) * s,
    g: A.g + (B.g - A.g) * s,
    b: A.b + (B.b - A.b) * s,
    a: A.a + (B.a - A.a) * s,
  })
}

function alpha(color, a) {
  const c = parseColor(color)
  return formatHex({ r: c.r, g: c.g, b: c.b, a: clamp(a, 0, 1) })
}

function luminance(color) {
  const c = parseColor(color)
  const channel = (v) => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
}

function readableOn(bg, lightOption, darkOption) {
  return luminance(bg) > 0.5 ? darkOption : lightOption
}

// ---------------------------------------------------------------------------
// Background image helpers
// ---------------------------------------------------------------------------

// Stock (built-in) base surfaces, used when a background image is enabled on
// the `stock` preset — that preset derives no palette, so only these two
// surfaces are made translucent to let the wallpaper through.
const STOCK_BASE = { light: '#FFFFFF', dark: '#151517' }
const STOCK_SIDEBAR = { light: '#F9FAFB', dark: '#1B1B1C' }

const DEFAULT_IMAGE_MASK = 70
const DEFAULT_IMAGE_BLUR = 0

function imageMask(cfg) {
  const raw = typeof cfg?.backgroundImageMask === 'number' ? cfg.backgroundImageMask : -1
  return clamp(raw < 0 ? DEFAULT_IMAGE_MASK : raw, 0, 100)
}

function imageBlur(cfg) {
  const raw = typeof cfg?.backgroundImageBlur === 'number' ? cfg.backgroundImageBlur : -1
  return clamp(raw < 0 ? DEFAULT_IMAGE_BLUR : raw, 0, 60)
}

function imageSize(cfg) {
  const value = cfg?.backgroundImageSize
  return value === 'contain' || value === 'auto' ? value : 'cover'
}

function imagePosition(cfg) {
  const value = typeof cfg?.backgroundImagePosition === 'string' ? cfg.backgroundImagePosition : ''
  // Position is a CSS value; drop anything that could escape the declaration.
  return value.replace(/[{};<>]/g, '').trim() || 'center'
}

function cssUrl(value) {
  const url = String(value ?? '').replace(/[\r\n]/g, '').trim()
  if (!url) return ''
  return 'url("' + url.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/</g, '\\3c ') + '")'
}

// A fixed, viewport-covering layer painted below all app content. It carries
// the wallpaper and the optional blur; the translucent `--dsw-alias-bg-base`
// surface above it is what tints the image and keeps text readable.
function backdropDeclarations(cfg) {
  if (!cfg || !cfg.backgroundImage) return ''
  const blur = imageBlur(cfg)
  const inset = blur > 0 ? -(blur * 2 + 40) : 0
  return 'content:"";position:fixed;inset:' + inset + 'px;z-index:-1;pointer-events:none;'
    + 'background-image:' + cssUrl(cfg.backgroundImage) + ';'
    + 'background-size:' + imageSize(cfg) + ';'
    + 'background-position:' + imagePosition(cfg) + ';'
    + 'background-repeat:no-repeat;'
    + (blur > 0 ? 'filter:blur(' + blur + 'px);' : '')
}

export function generateBackdropCss(light, dark) {
  const lightDecls = backdropDeclarations(light)
  const darkDecls = backdropDeclarations(dark)
  // The empty rules cancel a backdrop injected by an earlier response (or by
  // the host config) after the studio clears the image, so they are always
  // emitted rather than skipped.
  return 'html body::before{' + (lightDecls || 'content:none;display:none;background-image:none;filter:none;') + '}'
    + 'html body[data-ds-dark-theme]::before{' + (darkDecls || 'content:none;display:none;background-image:none;filter:none;') + '}'
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export const presets = {
  stock: {
    name: 'stock',
    label: 'DeepSeek 默认',
    light: { accent: '', background: '', foreground: '', translucentSidebar: 'preset', contrast: -1 },
    dark: { accent: '', background: '', foreground: '', translucentSidebar: 'preset', contrast: -1 },
  },
  nord: {
    name: 'nord',
    label: 'Nord',
    light: {
      accent: '#5E81AC',
      background: '#ECEFF4',
      foreground: '#2E3440',
      translucentSidebar: 'off',
      contrast: 60,
    },
    dark: {
      accent: '#88C0D0',
      background: '#2E3440',
      foreground: '#ECEFF4',
      translucentSidebar: 'on',
      contrast: 60,
    },
  },
  solarized: {
    name: 'solarized',
    label: 'Solarized',
    light: {
      accent: '#B58900',
      background: '#FDF6E3',
      foreground: '#657B83',
      translucentSidebar: 'off',
      contrast: 55,
    },
    dark: {
      accent: '#268BD2',
      background: '#002B36',
      foreground: '#839496',
      translucentSidebar: 'on',
      contrast: 55,
    },
  },
  onedark: {
    name: 'onedark',
    label: 'One Dark',
    light: {
      accent: '#4078F2',
      background: '#FAFAFA',
      foreground: '#383A42',
      translucentSidebar: 'off',
      contrast: 60,
    },
    dark: {
      accent: '#61AFEF',
      background: '#282C34',
      foreground: '#ABB2BF',
      translucentSidebar: 'on',
      contrast: 60,
    },
  },
}

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

const ModeSchema = z.object({
  accent: z.string().default(''),
  background: z.string().default(''),
  foreground: z.string().default(''),
  translucentSidebar: z.union(['preset', 'on', 'off']).default('preset'),
  contrast: z.number().default(-1),
  backgroundImage: z.string().default(''),
  backgroundImageMask: z.number().default(-1),
  backgroundImageBlur: z.number().default(-1),
  backgroundImageSize: z.union(['cover', 'contain', 'auto']).default('cover'),
  backgroundImagePosition: z.string().default('center'),
})

export const Config = z.object({
  // `codex-warm` / `graphite` are retired preset ids: accepted so existing
  // cordis.patch.yml files keep validating, resolved to Nord below.
  preset: z.union(['stock', 'nord', 'solarized', 'onedark', 'custom', 'codex-warm', 'graphite']).default('nord'),
  // 卡片布局是全局开关（不按 light/dark 分模式），默认关闭。
  cardLayout: z.boolean().default(false),
  // 内容列宽度（px，经平台 --dsh-chat-user-width 下发）：>=400 生效（clamp
  // 400..2400），-1 表示不限（跟随平台自动宽度）。
  centerContentWidth: z.number().default(-1),
  light: ModeSchema.default({}),
  dark: ModeSchema.default({}),
})

// ---------------------------------------------------------------------------
// Derive one mode's tokens (returns { colors })
// ---------------------------------------------------------------------------

function deriveMode(mode, cfg, cardLayout) {
  const bg = cfg.background
  const fg = cfg.foreground
  const accent = cfg.accent
  const ts = cfg.translucentSidebar
  const contrast = cfg.contrast
  const k = clamp(contrast / 100, 0, 1)
  const layerF = clamp(0.6 + 0.8 * k, 0, 1)
  const borderF = clamp(0.5 + 0.9 * k, 0, 1)
  const labelF = clamp(1.4 - 0.8 * k, 0, 1)
  const textOnAccent = readableOn(accent, '#FFFFFF', '#0F1115')
  const translucent = ts === 'on'
  const hasImage = Boolean(cfg.backgroundImage)
  const mask = imageMask(cfg) / 100
  const sidebarBase = mix(bg, fg, 0.03 * layerF)
  // With a wallpaper, the base surface (and the sidebar) turn translucent so
  // the image shows through; the mask percentage is how much theme color stays.
  const sidebarFill = hasImage
    ? alpha(sidebarBase, mask)
    : translucent
      ? alpha(sidebarBase, 0.65)
      : sidebarBase
  const baseFill = hasImage ? alpha(bg, mask) : bg
  const isLight = mode === 'light'
  // Derived once so the toast surface and its label stay a readable pair.
  const toastBg = mix(bg, fg, isLight ? 0.82 : 0.22)

  const colors = {
    '--dsw-alias-bg-base': baseFill,
    '--dsw-alias-bg-layer-1': mix(bg, fg, 0.02 * layerF),
    '--dsw-alias-bg-layer-2': mix(bg, fg, 0.04 * layerF),
    '--dsw-alias-bg-layer-3': mix(bg, fg, 0.06 * layerF),
    '--dsw-alias-bg-overlay': alpha(mix(bg, fg, isLight ? 0.08 * layerF : 0.04 * layerF), 0.9),
    '--dsw-alias-bg-mask-1': alpha('#000000', isLight ? 0.24 : 0.5),
    '--dsw-alias-bg-mask-2': alpha('#000000', isLight ? 0.12 : 0.2),
    '--dsw-alias-bg-mask-3': alpha('#000000', 0.48),
    '--dsw-alias-bg-mask-photo': alpha('#000000', 0.88),
    '--dsw-alias-bg-mask-drop': alpha(mix(bg, fg, 0.12), 0.7),
    '--dsw-alias-bg-module-platform': mix(bg, fg, 0.025 * layerF),
    '--dsw-alias-bg-multi-select': mix(bg, fg, 0.03 * layerF),
    '--dsw-alias-bg-skeleton': alpha(fg, 0.06),
    '--dsw-alias-bg-document-preview': mix(bg, fg, 0.03 * layerF),
    '--dsw-alias-bg-document-selection': alpha(accent, 0.4),
    '--dsw-alias-border-l1': alpha(fg, 0.04 * borderF),
    '--dsw-alias-border-l2': alpha(fg, 0.10 * borderF),
    '--dsw-alias-border-l2-darkmode-thin': alpha(fg, 0.06 * borderF),
    '--dsw-alias-border-l3': alpha(fg, 0.12 * borderF),
    '--dsw-alias-border-l4': alpha(fg, 0.16 * borderF),
    '--dsw-alias-border-inverted': alpha(bg, 0.06),
    '--dsw-alias-border-inverted2': alpha(bg, 0.08),
    // 0.2.2 引擎不派生的结构性 alias token（state-*/code-diff-*/file-diff-* 等
    // 语义 token 保持引擎原意，不在这里覆盖）。
    '--dsw-alias-settings-card-fill': mix(bg, fg, 0.04 * layerF),
    '--dsw-alias-settings-card-stroke': alpha(fg, 0.16 * borderF),
    '--dsw-alias-illustration-background': mix(bg, fg, 0.10 * layerF),
    '--dsw-alias-illustration-backing': mix(bg, fg, 0.18 * layerF),
    '--dsw-alias-illustration-detail': mix(bg, fg, 0.26 * layerF),
    '--dsw-alias-illustration-inset': mix(bg, fg, 0.06 * layerF),
    '--dsw-alias-illustration-shadow': alpha('#000000', isLight ? 0.08 : 0.4),
    '--dsw-alias-illustration-surface': mix(bg, fg, 0.05 * layerF),
    '--dsw-alias-label-shimmer': alpha(fg, isLight ? 0.3 : 0.45),
    '--dsw-alias-switch-thumb': isLight ? '#FFFFFF' : mix(bg, fg, 0.4),
    '--dsw-alias-tooltip-key-bg': mix(mix(bg, fg, isLight ? 0.78 : 0.26), '#FFFFFF', 0.18),
    '--dsw-alias-turn-trigger-bg': mix(bg, fg, 0.02 * layerF),
    '--dsw-alias-turn-trigger-bg-hover': alpha(fg, 0.06),
    '--dsw-alias-menu-group-header-fill': alpha(mix(bg, fg, 0.02 * layerF), 0.94),
    '--dsw-alias-onboarding-card-fill': alpha(mix(bg, fg, 0.02 * layerF), 0.8),
    '--dsw-alias-onboarding-secondary-fill': mix(bg, fg, 0.03 * layerF),
    '--dsw-alias-onboarding-checkbox-border': alpha(fg, 0.2 * borderF),
    '--dsw-alias-brand-primary': accent,
    '--dsw-alias-brand-primary-invert': textOnAccent,
    '--dsw-alias-brand-text': accent,
    '--dsw-alias-brand-primary-new-colorprimary-new-color': accent,
    '--dsw-alias-link': accent,
    '--dsw-alias-label-primary-foreground': textOnAccent,
    '--dsw-alias-button-primary-fill': accent,
    '--dsw-alias-button-primary-hover': mix(accent, textOnAccent, 0.12),
    '--dsw-alias-button-primary-dimmed': mix(bg, fg, 0.08 * layerF),
    '--dsw-alias-button-contrast-fill': fg,
    '--dsw-alias-button-elevated-fill': mix(bg, fg, 0.04 * layerF),
    '--dsw-alias-button-floating-fill': mix(bg, fg, 0.02 * layerF),
    '--dsw-alias-button-floating-hover': mix(bg, fg, 0.05 * layerF),
    '--dsw-alias-button-ghost-active-border': mix(bg, fg, 0.35 * borderF),
    '--dsw-alias-button-ghost-active-fill': mix(bg, fg, 0.06 * layerF),
    '--dsw-alias-button-ghost-active-hover': mix(bg, fg, 0.09 * layerF),
    '--dsw-alias-button-info-fill': accent,
    '--dsw-alias-button-info-hover': mix(accent, textOnAccent, 0.12),
    // 0.2.2-rc.1 toolbar buttons: translucent fills derived from the palette
    // instead of the stock fixed grays, so icon bars follow every preset.
    '--dsw-alias-button-tool-bar-fill': alpha(mix(fg, bg, 0.35), 0.5),
    '--dsw-alias-button-tool-bar-fill-invisible': alpha(fg, 0.36),
    '--dsw-alias-button-tool-bar-hover': alpha(mix(fg, bg, 0.35), 0.6),
    '--dsw-alias-interactive-bg-hover': alpha(fg, 0.06),
    '--dsw-alias-interactive-bg-active': alpha(fg, 0.12),
    '--dsw-alias-interactive-bg-hover-accent': alpha(accent, 0.14),
    '--dsw-alias-interactive-bg-hover-solid': mix(bg, fg, 0.04 * layerF),
    '--dsw-alias-interactive-bg-hover-danger': alpha('#EC1313', 0.05),
    '--dsw-alias-label-primary': fg,
    '--dsw-alias-label-primary-dimmed': mix(fg, bg, 0.10 * labelF),
    '--dsw-alias-label-primary-bluish': fg,
    '--dsw-alias-label-primary-inverted': bg,
    '--dsw-alias-label-secondary': mix(fg, bg, 0.28 * labelF),
    '--dsw-alias-label-tertiary': mix(fg, bg, 0.42 * labelF),
    '--dsw-alias-label-caption': mix(fg, bg, 0.55 * labelF),
    '--dsw-alias-label-dimmed': mix(fg, bg, 0.72 * labelF),
    '--dsw-alias-label-deep-diving': mix(accent, fg, 0.3),
    '--dsw-alias-label-deep-diving-shimmer': mix(accent, fg, 0.7),
    '--dsw-alias-label-document-preview': mix(fg, bg, 0.34 * labelF),
    '--dsw-alias-menu-icon': mix(fg, bg, 0.34 * labelF),
    '--dsw-alias-markdown-code-block': mix(bg, fg, 0.02 * layerF),
    '--dsw-alias-markdown-code-block-banner': mix(bg, fg, 0.03 * layerF),
    '--dsw-alias-markdown-inline-code': mix(bg, fg, 0.04 * layerF),
    '--dsw-alias-markdown-citation': mix(bg, fg, 0.04 * layerF),
    '--dsw-alias-markdown-code-segment-selected': mix(bg, fg, 0.07 * layerF),
    '--dsw-alias-markdown-code-segment-unselected': mix(bg, fg, 0.02 * layerF),
    '--dsw-alias-markdown-placeholder': mix(bg, fg, 0.03 * layerF),
    '--dsw-alias-markdown-tag': mix(bg, fg, 0.03 * layerF),
    '--dsw-alias-scrollbar-bg-l1': mix(bg, fg, 0.12 * borderF),
    '--dsw-alias-scrollbar-bg-l2': mix(bg, fg, 0.12 * borderF),
    '--dsw-alias-scrollbar-hover-l1': mix(bg, fg, 0.20 * borderF),
    '--dsw-alias-scrollbar-hover-l2': mix(bg, fg, 0.20 * borderF),
    '--dsw-alias-state-business-primary': accent,
    '--dsw-alias-state-business-tertiary': mix(accent, bg, 0.55),
    '--dsw-alias-onboarding-accent': accent,
    '--dsw-alias-toast-bg': toastBg,
    '--dsw-alias-toast-label': readableOn(toastBg, '#FFFFFF', '#0F1115'),
    '--dsw-alias-tooltip-bg': mix(bg, fg, isLight ? 0.78 : 0.26),
    '--dsw-specific-bubble': mix(bg, accent, 0.06),
    '--dsw-specific-bubble-highlight': mix(bg, accent, 0.18),
    '--dsw-specific-input-major': mix(bg, fg, 0.01 * layerF),
    '--dsw-specific-login-input': mix(bg, fg, 0.02 * layerF),
    '--dsw-specific-menu': mix(bg, fg, 0.06 * layerF),
    '--dsw-specific-selector': mix(bg, fg, 0.025 * layerF),
    '--dsw-specific-tip': mix(bg, fg, 0.025 * layerF),
    '--dsw-specific-sidebar-fill': sidebarFill,
    '--dsw-specific-sidebar-nav-item-active-accent': mix(bg, accent, 0.12),
    '--dsw-specific-sidebar-nav-item-active': mix(bg, fg, 0.06 * layerF),
    '--dsw-specific-sidebar-nav-item-hover': mix(bg, fg, 0.03 * layerF),
  }

  // 卡片布局的五个自定义属性同样按模式派生，由主题呈现层像 token 一样应用。
  if (cardLayout) Object.assign(colors, cardTokens(mode, bg, fg, cfg))

  return { colors }
}

// ---------------------------------------------------------------------------
// Preset + custom merge
// ---------------------------------------------------------------------------

function resolveMode(mode, preset, custom) {
  const p = preset[mode]
  const c = custom || {}
  return {
    accent: c.accent || p.accent,
    background: c.background || p.background,
    foreground: c.foreground || p.foreground,
    translucentSidebar: c.translucentSidebar !== 'preset' ? c.translucentSidebar : p.translucentSidebar,
    contrast: c.contrast >= 0 ? c.contrast : p.contrast,
    backgroundImage: c.backgroundImage || p.backgroundImage || '',
    backgroundImageMask: c.backgroundImageMask >= 0 ? c.backgroundImageMask : (p.backgroundImageMask ?? -1),
    backgroundImageBlur: c.backgroundImageBlur >= 0 ? c.backgroundImageBlur : (p.backgroundImageBlur ?? -1),
    backgroundImageSize: c.backgroundImageSize || p.backgroundImageSize || 'cover',
    backgroundImagePosition: c.backgroundImagePosition || p.backgroundImagePosition || 'center',
  }
}

function resolveConfig(raw) {
  const presetName = raw.preset
  // `custom` 与未知值都回退到 Nord（防御旧配置里残留的已删除预设名）。
  const preset = presetName === 'custom' ? presets.nord : (presets[presetName] ?? presets.nord)
  return {
    light: resolveMode('light', preset, raw.light),
    dark: resolveMode('dark', preset, raw.dark),
  }
}

// ---------------------------------------------------------------------------
// Card layout & center width (optional)
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'dsh-card-theme:selection'
const CARD_ATTRIBUTE = 'data-dsh-card-theme'
// Canonical stylesheet shared verbatim with client.js (test/parity-check.mjs compares it).
const CARD_LAYOUT_CSS = `
html[data-dsh-card-theme] div:has(> [data-rightbar-col]):has(> [data-shell-bottom]){background:var(--dsh-theme-canvas,var(--dsw-alias-bg-base))}
html[data-dsh-card-theme] div:has(> [data-rightbar-col]):has(> [data-shell-bottom])>[class*="sidebarCol"]{margin:var(--dsh-card-theme-gap,8px);border-right:0;border-radius:var(--dsh-card-theme-radius,12px);background:var(--dsw-specific-sidebar-fill);box-shadow:inset 0 0 0 .5px var(--dsh-card-theme-border,transparent)}
html[data-dsh-card-theme] div:has(> [data-rightbar-col]):has(> [data-shell-bottom])>div:has(+ [data-rightbar-col]){margin:var(--dsh-card-theme-gap,8px);border-left:0;border-radius:var(--dsh-card-theme-radius,12px);background:var(--dsh-card-theme-bg,var(--dsw-alias-bg-base));box-shadow:inset 0 0 0 .5px var(--dsh-card-theme-border,transparent)}
html[data-dsh-card-theme] div[data-sidebar-right-panel="push"]{width:calc(var(--dsh-sidebar-width) - var(--dsh-card-theme-gap,8px))!important;top:var(--dsh-card-theme-gap,8px);bottom:var(--dsh-card-theme-gap,8px);right:var(--dsh-card-theme-gap,8px);border-radius:var(--dsh-card-theme-radius,12px)}
html[data-dsh-card-theme] div[data-sidebar-right-panel="push"][data-sidebar-right-open]{background:var(--dsh-card-theme-bg,var(--dsw-alias-bg-base));box-shadow:inset 0 0 0 .5px var(--dsh-card-theme-border,transparent)}
`

// 平台自身的会话内容宽度变量：document 级下发后，内容列直接取该值且不再走 clamp；
// 平台原生拖拽写在元素内联样式上，仍可局部覆盖。
const CENTER_TOKEN = '--dsh-chat-user-width'

// 内容列目标宽度：>=400 生效（clamp 400..2400），其余值（默认 -1）表示不限。
function centerWidthValue(raw) {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 400 ? Math.min(2400, Math.round(raw)) : -1
}

// The five custom properties that switch the card stylesheet on. Values are
// emitted per mode and applied by the theme presenter exactly like tokens.
function cardTokens(mode, bg, fg, cfg) {
  const isLight = mode === 'light'
  const hasImage = Boolean(cfg.backgroundImage)
  const mask = imageMask(cfg) / 100
  const canvas = mix(bg, '#000000', isLight ? 0.04 : 0.22)
  return {
    '--dsh-card-theme-gap': '8px',
    '--dsh-card-theme-radius': '12px',
    '--dsh-theme-canvas': hasImage ? alpha(canvas, mask) : canvas,
    '--dsh-card-theme-bg': hasImage ? alpha(bg, mask) : bg,
    '--dsh-card-theme-border': alpha(fg, 0.1),
  }
}

// First-paint attribute switch: honors the host config and a saved studio
// selection (so a toggled-on card layout does not flash back on reload). The
// content width is published through the platform's own --dsh-chat-user-width
// variable on <html>, so the conversation column takes exactly that width at
// first paint; the platform's native drag (element-level inline style) still
// wins locally.
export function layoutBootScript(rawConfig) {
  const fromConfig = rawConfig?.cardLayout === true ? 'true' : 'false'
  const centerFromConfig = centerWidthValue(rawConfig?.centerContentWidth)
  return "(function(){try{var s=JSON.parse(localStorage.getItem('" + STORAGE_KEY + "')||'null')||{};"
    + 'if(s.cardLayout===true||' + fromConfig + ")document.documentElement.setAttribute('" + CARD_ATTRIBUTE + "','');"
    + 'var w=typeof s.centerContentWidth==="number"?(s.centerContentWidth>=400?Math.min(2400,Math.round(s.centerContentWidth)):-1):' + centerFromConfig + ';'
    + 'if(w>=400)document.documentElement.style.setProperty(' + "'" + CENTER_TOKEN + "',w+'px')"
    + '}catch(e){}})()'
}

// ---------------------------------------------------------------------------
// CSS generation
// ---------------------------------------------------------------------------

// 主题 token 的取值既可能是颜色，也可能是 8px/12px 这类布局长度：只把颜色
// 规范化成统一的 hex/rgba，布局值原样透传。
const COLOR_LIKE = /^(?:#[0-9a-f]{3,8}|rgba?\()/i

function formatToken(value) {
  return COLOR_LIKE.test(String(value)) ? formatHex(value) : value
}

// Render a token map to a CSS declaration list (empty values are skipped).
function renderDecls(tokens) {
  return Object.entries(tokens)
    .map(([key, value]) => (value ? key + ':' + formatToken(value) : ''))
    .filter(Boolean)
    .join(';')
}

// `stock` derives no palette. It still honours a background image: only the
// base and sidebar surfaces turn translucent so the wallpaper shows through.
function stockImageVars(cfg) {
  const mask = imageMask(cfg) / 100
  const mode = cfg.mode
  return '--dsw-alias-bg-base:' + alpha(STOCK_BASE[mode], mask)
    + ';--dsw-specific-sidebar-fill:' + alpha(STOCK_SIDEBAR[mode], mask)
}

// `stock` + card layout: only the five card properties per mode, so the built-in
// palette is otherwise untouched.
function stockCardVars(mode, cfg) {
  return renderDecls(cardTokens(mode, STOCK_BASE[mode], mode === 'light' ? '#000000' : '#FFFFFF', cfg))
}

export function generateCss(rawConfig) {
  const config = rawConfig ?? {}
  const cfg = resolveConfig(config)
  const cardLayout = config.cardLayout === true
  const hasImage = Boolean(cfg.light.backgroundImage || cfg.dark.backgroundImage)
  const backdrop = hasImage ? generateBackdropCss(cfg.light, cfg.dark) : ''

  if (config.preset === 'stock') {
    let css = ''
    if (cfg.light.backgroundImage) css += 'html body{' + stockImageVars({ ...cfg.light, mode: 'light' }) + '}'
    if (cfg.dark.backgroundImage) css += 'html body[data-ds-dark-theme]{' + stockImageVars({ ...cfg.dark, mode: 'dark' }) + '}'
    if (cardLayout) {
      css += 'html body{' + stockCardVars('light', cfg.light) + '}'
      css += 'html body[data-ds-dark-theme]{' + stockCardVars('dark', cfg.dark) + '}'
    }
    return css + backdrop + CARD_LAYOUT_CSS
  }

  const lightCss = renderDecls(deriveMode('light', cfg.light, cardLayout).colors)
  const darkCss = renderDecls(deriveMode('dark', cfg.dark, cardLayout).colors)
  let css = ''
  if (lightCss) css += 'html body{' + lightCss + '}'
  if (darkCss) css += 'html body[data-ds-dark-theme]{' + darkCss + '}'
  return css + backdrop + CARD_LAYOUT_CSS
}

// The web-shell creates client entries with `{ name }` only (dsh-client-modules
// `create(loader, id)`), so a client plugin's `apply(ctx, config)` receives no
// config on 0.2.x. Publish the raw host config next to the style so the client
// half can still honour cordis.patch.yml / `dsh plugin config`.
// 0.2.x 桌面端走结构化的 `webserver/index-inject` 行表，配置由 global 行
// （CONFIG_GLOBAL）下发；旧 shell 走 tapIndex，配置由 JSON 载体元素下发。
export const CONFIG_ELEMENT_ID = 'dsh-card-theme-config'
export const CONFIG_GLOBAL = '__DSH_THEME_PLUGIN_CONFIG__'

// 纯函数：宿主配置 -> 下发载荷；undefined/null 按空对象处理。
export function carrierPayload(rawConfig) {
  const cfg = rawConfig ?? {}
  return {
    preset: cfg.preset,
    cardLayout: cfg.cardLayout === true,
    centerContentWidth: centerWidthValue(cfg.centerContentWidth),
    light: cfg.light ?? {},
    dark: cfg.dark ?? {},
  }
}

// 纯函数：把主题整理为 0.2.x 的结构化 index 注入行：配置 global、首屏布局
// 引导脚本 <script>（卡片布局 + 内容列宽度）、主题 <style>。手写配置里出现
// 不支持的色值时 generateCss 会抛错：这里吞掉并告警，保留前两行，绝不让坏配置
// 打断 index 渲染。
export function indexInjectionRows(rawConfig, warn) {
  const payload = carrierPayload(rawConfig)
  const rows = [
    { kind: 'global', name: CONFIG_GLOBAL, value: payload },
    { kind: 'script', placement: 'head', text: layoutBootScript(rawConfig) },
  ]
  try {
    rows.push({ kind: 'style', text: generateCss(payload) })
  } catch (error) {
    warn?.('dsh-card-theme: 跳过无效配置的主题 CSS', error)
  }
  return rows
}

export function injectConfig(html, rawConfig) {
  const json = JSON.stringify(carrierPayload(rawConfig))
  // A JSON block inside HTML must never terminate its own <script> element.
  const tag =
    '<script type="application/json" id="' + CONFIG_ELEMENT_ID + '">' + json.replace(/</g, '\\u003c') + '</script>'
  const headEnd = /<\/head>/i.exec(html)
  if (headEnd === null) return html + tag
  return html.slice(0, headEnd.index) + tag + html.slice(headEnd.index)
}

export function injectStyle(html, rawConfig) {
  const css = generateCss(rawConfig)
  const style = css ? '<style id="dsh-card-theme">' + css + '</style>' : ''
  // 旧 shell 没有结构化行：卡片属性开关与内容列宽度的 html 变量随样式一起内联。
  const boot = '<script>' + layoutBootScript(rawConfig) + '</script>'
  const withConfig = injectConfig(html, rawConfig)
  const markup = style + boot
  const headEnd = /<\/head>/i.exec(withConfig)
  if (headEnd === null) return withConfig + markup
  const at = headEnd.index
  return withConfig.slice(0, at) + markup + withConfig.slice(at)
}

// ---------------------------------------------------------------------------
// Cordis plugin entry
// ---------------------------------------------------------------------------

export function apply(ctx, rawConfig) {
  ctx.inject(['webServer'], (httpCtx) => {
    const webServer = httpCtx.webServer
    if (typeof webServer.collectIndexInjections === 'function') {
      // 0.2.x：桌面端启动载荷与 HTTP 渲染共用这份行表；tapIndex 在桌面路径上
      // 不会执行，所以主题与配置必须走结构化注入。
      httpCtx.on('webserver/index-inject', (table) => {
        try {
          table.push(...indexInjectionRows(rawConfig, (message, error) => httpCtx.logger?.warn?.(message, error)))
        } catch (error) {
          httpCtx.logger?.warn?.('dsh-card-theme: index injection failed', error)
        }
      })
      return
    }
    // 旧 shell：只能做原始 index 文本变换（配置通过 DOM 载体下发）。
    httpCtx.effect(
      () => webServer.tapIndex((html) => injectStyle(html, rawConfig)),
      'dsh-card-theme: inject theme CSS and the host-config carrier into index responses',
    )
  })
}
