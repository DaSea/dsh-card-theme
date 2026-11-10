// Client bundle (official web-shell closure-factory shape).
// The shell serves this file as /plugins/dsh-card-theme/client.js and mounts
// it through the module table; React arrives via require("react") (platform
// seed module). Plain JS only: no TS/JSX/import statements.
//
// Provides the "主题工作室" settings section: palette picker, translucent-sidebar
// and contrast controls, the background-image picker, the optional card layout
// for the three columns, and the center content-column width. Every change
// hot-applies through the official theme service (ctx.theme.overrideTokens) —
// on 0.2.x the ThemePresenter writes the composed tokens as inline styles on
// <body>, so switching takes effect immediately, no page refresh. The selection
// is persisted in localStorage.
//
// Fonts are owned by the platform's own Appearance settings now, so this plugin
// configures no font families (neither as preset values nor as overrides).
//
// 0.2.x no longer passes cordis config to client plugins, so the initial
// selection comes from the host-config carrier the host half publishes
// (globalThis.__DSH_THEME_PLUGIN_CONFIG__, or the older DOM JSON block). The
// carrier also carries `cardLayout` and `centerContentWidth`, which the host
// half reflects in the first-paint CSS; the client keeps them live with
// html[data-dsh-card-theme] and an inline --dsh-chat-user-width custom
// property on <html> (the conversation content column reads that property).
//
// The color derivation below is a copy of index.js (same pure functions,
// kept in sync manually; test/parity-check.mjs guards the drift).
window.__ModuleLoader__.load({
  id: 'dsh-card-theme',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')

    // ---------------------------------------------------------------------
    // Color math (mirrors index.js)
    // ---------------------------------------------------------------------

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

    // ---------------------------------------------------------------------
    // Background image helpers (mirrors index.js)
    // ---------------------------------------------------------------------

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
      return value.replace(/[{};<>]/g, '').trim() || 'center'
    }

    function cssUrl(value) {
      const url = String(value ?? '').replace(/[\r\n]/g, '').trim()
      if (!url) return ''
      return 'url("' + url.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/</g, '\\3c ') + '")'
    }

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

    function generateBackdropCss(light, dark) {
      const lightDecls = backdropDeclarations(light)
      const darkDecls = backdropDeclarations(dark)
      return 'html body::before{' + (lightDecls || 'content:none;display:none;background-image:none;filter:none;') + '}'
        + 'html body[data-ds-dark-theme]::before{' + (darkDecls || 'content:none;display:none;background-image:none;filter:none;') + '}'
    }

    // ---------------------------------------------------------------------
    // Card layout (mirrors index.js)
    // ---------------------------------------------------------------------

    const CARD_ATTRIBUTE = 'data-dsh-card-theme'
    // Canonical stylesheet shared verbatim with index.js (parity-check compares it).
    const CARD_LAYOUT_CSS = `
html[data-dsh-card-theme] div:has(> [data-rightbar-col]):has(> [data-shell-bottom]){background:var(--dsh-theme-canvas,var(--dsw-alias-bg-base))}
html[data-dsh-card-theme] div:has(> [data-rightbar-col]):has(> [data-shell-bottom])>[class*="sidebarCol"]{margin:var(--dsh-card-theme-gap,8px);border-right:0;border-radius:var(--dsh-card-theme-radius,12px);background:var(--dsw-specific-sidebar-fill);box-shadow:inset 0 0 0 .5px var(--dsh-card-theme-border,transparent)}
html[data-dsh-card-theme] div:has(> [data-rightbar-col]):has(> [data-shell-bottom])>div:has(+ [data-rightbar-col]){margin:var(--dsh-card-theme-gap,8px);border-left:0;border-radius:var(--dsh-card-theme-radius,12px);background:var(--dsh-card-theme-bg,var(--dsw-alias-bg-base));box-shadow:inset 0 0 0 .5px var(--dsh-card-theme-border,transparent)}
html[data-dsh-card-theme] div[data-sidebar-right-panel="push"]{width:calc(var(--dsh-sidebar-width) - var(--dsh-card-theme-gap,8px))!important;top:var(--dsh-card-theme-gap,8px);bottom:var(--dsh-card-theme-gap,8px);right:var(--dsh-card-theme-gap,8px);border-radius:var(--dsh-card-theme-radius,12px)}
html[data-dsh-card-theme] div[data-sidebar-right-panel="push"][data-sidebar-right-open]{background:var(--dsh-card-theme-bg,var(--dsw-alias-bg-base));box-shadow:inset 0 0 0 .5px var(--dsh-card-theme-border,transparent)}
`

    const CENTER_TOKEN = '--dsh-chat-user-width'

    // The five custom properties that switch the card stylesheet on.
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

    // Center content-column width: one global px value (not per mode);
    // anything below 400 — including -1 and non-numbers — means 跟随默认.
    function centerWidthValue(raw) {
      return typeof raw === 'number' && Number.isFinite(raw) && raw >= 400 ? Math.min(2400, Math.round(raw)) : -1
    }

    // ---------------------------------------------------------------------
    // Presets (mirrors index.js)
    // ---------------------------------------------------------------------

    const presets = {
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

    // ---------------------------------------------------------------------
    // Derive one mode's tokens (mirrors index.js deriveMode)
    // ---------------------------------------------------------------------

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
      }

      if (cardLayout) Object.assign(colors, cardTokens(mode, bg, fg, cfg))

      return { colors }
    }

    // ---------------------------------------------------------------------
    // Selection → override layer (per-token { light, dark } pairs)
    // ---------------------------------------------------------------------

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

    // Selection shape: { preset, accent, background, foreground,
    // translucentSidebar, contrast, cardLayout, centerContentWidth } — empty
    // color strings and 'preset' fall back to the selected preset's own values.
    // Optional `darkCustom` carries host-config-only dark paints; the studio
    // writes one value for both modes and drops the overlay on any edit.
    function customOf(src) {
      return {
        accent: typeof src.accent === 'string' ? src.accent : '',
        background: typeof src.background === 'string' ? src.background : '',
        foreground: typeof src.foreground === 'string' ? src.foreground : '',
        translucentSidebar: typeof src.translucentSidebar === 'string' ? src.translucentSidebar : 'preset',
        contrast: typeof src.contrast === 'number' ? src.contrast : -1,
        backgroundImage: typeof src.backgroundImage === 'string' ? src.backgroundImage : '',
        backgroundImageMask: typeof src.backgroundImageMask === 'number' ? src.backgroundImageMask : -1,
        backgroundImageBlur: typeof src.backgroundImageBlur === 'number' ? src.backgroundImageBlur : -1,
        backgroundImageSize: typeof src.backgroundImageSize === 'string' ? src.backgroundImageSize : 'cover',
        backgroundImagePosition: typeof src.backgroundImagePosition === 'string' ? src.backgroundImagePosition : 'center',
      }
    }

    function resolveSelection(sel) {
      const isStock = sel.preset === 'stock'
      // `stock` keeps the built-in palette; everything else (including legacy
      // or `custom` config presets) falls back to nord's paint values.
      const base = isStock ? presets.stock : (presets[sel.preset] ?? presets.nord)
      const custom = customOf(sel)
      const customDark = sel.darkCustom && typeof sel.darkCustom === 'object' ? customOf(sel.darkCustom) : custom
      return {
        isStock,
        base,
        cardLayout: sel.cardLayout === true,
        centerContentWidth: centerWidthValue(sel.centerContentWidth),
        light: resolveMode('light', base, custom),
        dark: resolveMode('dark', base, customDark),
      }
    }

    // stock keeps the built-in palette. A wallpaper still needs the base and
    // sidebar surfaces translucent, expressed with the same custom tokens the
    // derived palettes use, so the studio can clear the host config's image too.
    function stockSurfaceTokens(lightCfg, darkCfg, cardLayout) {
      const tokens = {}
      const lightImage = Boolean(lightCfg.backgroundImage)
      const darkImage = Boolean(darkCfg.backgroundImage)
      const lightMask = imageMask(lightCfg) / 100
      const darkMask = imageMask(darkCfg) / 100
      tokens['--dsw-alias-bg-base'] = {
        light: lightImage ? alpha(STOCK_BASE.light, lightMask) : STOCK_BASE.light,
        dark: darkImage ? alpha(STOCK_BASE.dark, darkMask) : STOCK_BASE.dark,
      }
      tokens['--dsw-specific-sidebar-fill'] = {
        light: lightImage ? alpha(STOCK_SIDEBAR.light, lightMask) : STOCK_SIDEBAR.light,
        dark: darkImage ? alpha(STOCK_SIDEBAR.dark, darkMask) : STOCK_SIDEBAR.dark,
      }
      if (cardLayout) {
        const lightCards = cardTokens('light', STOCK_BASE.light, '#000000', lightCfg)
        const darkCards = cardTokens('dark', STOCK_BASE.dark, '#FFFFFF', darkCfg)
        for (const name of Object.keys(lightCards)) {
          tokens[name] = { light: lightCards[name], dark: darkCards[name] }
        }
      }
      return tokens
    }

    function buildOverride(resolved) {
      const { isStock, cardLayout, light: lightCfg, dark: darkCfg } = resolved
      const tokens = {}
      if (!isStock) {
        const light = deriveMode('light', lightCfg, cardLayout)
        const dark = deriveMode('dark', darkCfg, cardLayout)
        for (const name of Object.keys(light.colors)) {
          const l = light.colors[name]
          const d = dark.colors[name]
          if (l) tokens[name] = { light: l, dark: d }
        }
      } else {
        Object.assign(tokens, stockSurfaceTokens(lightCfg, darkCfg, cardLayout))
      }
      return tokens
    }

    // The wallpaper layer cannot be expressed as a color token, so it gets its
    // own stylesheet. Both mode rules are emitted; the dark selector keys off
    // the body attribute the theme presenter maintains, so switching modes does
    // not need a re-apply.
    const BACKDROP_STYLE_ID = 'dsh-card-theme-backdrop'

    function applyBackdrop(lightCfg, darkCfg) {
      let element = document.getElementById(BACKDROP_STYLE_ID)
      if (element === null) {
        element = document.createElement('style')
        element.id = BACKDROP_STYLE_ID
        const head = document.head || document.documentElement
        head.appendChild(element)
      }
      element.textContent = generateBackdropCss(lightCfg, darkCfg)
    }

    // The card stylesheet is static; it is injected once and switched on/off by
    // the html attribute. The host half writes the same rule block into the
    // first paint, so an initial cardLayout:true does not flash.
    const LAYOUT_STYLE_ID = 'dsh-card-theme-layout'

    function applyLayoutStyle() {
      let element = document.getElementById(LAYOUT_STYLE_ID)
      if (element === null) {
        element = document.createElement('style')
        element.id = LAYOUT_STYLE_ID
        const head = document.head || document.documentElement
        head.appendChild(element)
      }
      element.textContent = CARD_LAYOUT_CSS
    }

    function applyCardLayout(enabled) {
      document.documentElement.toggleAttribute(CARD_ATTRIBUTE, enabled === true)
    }

    // The conversation content column reads --dsh-chat-user-width, so an inline
    // value on <html> sizes the column exactly (gutters excluded). Element-level
    // inline values written by the platform's native drag still win locally;
    // embedded/subagent views define their own content-width and are untouched.
    function applyCenterWidth(px) {
      const el = document.documentElement
      if (typeof px === 'number' && px >= 400) el.style.setProperty(CENTER_TOKEN, Math.min(2400, Math.round(px)) + 'px')
      else el.style.removeProperty(CENTER_TOKEN)
    }

    // ---------------------------------------------------------------------
    // Persistence
    // ---------------------------------------------------------------------

    const STORE_KEY = 'dsh-card-theme:selection'

    function loadSelection() {
      try {
        const raw = window.localStorage.getItem(STORE_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && typeof parsed.preset === 'string') return parsed
      } catch {}
      return null
    }

    // 0.2.x web-shell builds client entries as `{ name }` (dsh-client-modules
    // create(loader, id)), so apply(ctx, config) no longer receives the cordis
    // config. The host half publishes it as `globalThis.__DSH_THEME_PLUGIN_CONFIG__`
    // via the structured `webserver/index-inject` row; older shells only get the
    // DOM carrier <script type="application/json" id="dsh-card-theme-config">.
    // See injectConfig() in index.js.
    const CONFIG_ELEMENT_ID = 'dsh-card-theme-config'

    function loadHostConfig() {
      try {
        const globalCfg = globalThis.__DSH_THEME_PLUGIN_CONFIG__
        if (globalCfg && typeof globalCfg === 'object') return globalCfg
      } catch {}
      try {
        const el = document.getElementById(CONFIG_ELEMENT_ID)
        if (el === null) return null
        const parsed = JSON.parse(el.textContent || '')
        if (parsed && typeof parsed === 'object') return parsed
      } catch {}
      return null
    }

    function saveSelection(sel) {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(sel))
      } catch {}
    }

    // ---------------------------------------------------------------------
    // Preset chips
    // ---------------------------------------------------------------------

    const PRESET_KEYS = ['stock', 'nord', 'solarized', 'onedark']

    // ---------------------------------------------------------------------
    // Local image picker
    // ---------------------------------------------------------------------

    // Data URLs live in localStorage with the rest of the selection, so large
    // photos are downscaled before they are stored. Small files keep their
    // original bytes (and transparency).
    const IMAGE_RAW_LIMIT = 1024 * 1024
    const IMAGE_MAX_SIDE = 1920

    function readAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(reader.error || new Error('无法读取图片文件'))
        reader.readAsDataURL(file)
      })
    }

    function loadImageElement(src) {
      return new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('该图片格式无法在此浏览器中读取'))
        image.src = src
      })
    }

    async function prepareBackgroundImage(file) {
      const raw = await readAsDataUrl(file)
      if (file.size <= IMAGE_RAW_LIMIT || file.type === 'image/svg+xml') return raw
      const image = await loadImageElement(raw)
      const width = image.naturalWidth || image.width
      const height = image.naturalHeight || image.height
      const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(width, height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const context = canvas.getContext('2d')
      if (context === null) return raw
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      try {
        return canvas.toDataURL('image/jpeg', 0.82)
      } catch {
        return raw
      }
    }

    // ---------------------------------------------------------------------
    // UI
    // ---------------------------------------------------------------------

    const style = {
      section: { display: 'flex', flexDirection: 'column', gap: '14px' },
      row: { display: 'flex', flexDirection: 'column', gap: '6px' },
      label: { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' },
      chips: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
      chip: {
        padding: '4px 12px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
        fontSize: '13px',
        lineHeight: '20px',
      },
      chipActive: {
        borderColor: 'var(--dsw-alias-brand-primary)',
        background: 'var(--dsw-alias-interactive-bg-hover-accent)',
        color: 'var(--dsw-alias-brand-text)',
      },
      select: {
        padding: '5px 8px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '13px',
      },
      input: {
        padding: '5px 8px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '13px',
        lineHeight: '20px',
        minWidth: 0,
      },
      range: { accentColor: 'var(--dsw-alias-brand-primary)' },
      hint: { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-caption)' },
    }

    // ---------------------------------------------------------------------
    // Cordis plugin entry
    // ---------------------------------------------------------------------

    exports.name = 'card-theme-plugin'

    exports.inject = ['slots', 'theme']

    const PRESET_IDS = new Set(Object.keys(presets))

    function normalizeSelection(sel) {
      return {
        preset: typeof sel.preset === 'string' && PRESET_IDS.has(sel.preset) ? sel.preset : 'nord',
        accent: typeof sel.accent === 'string' ? sel.accent : '',
        background: typeof sel.background === 'string' ? sel.background : '',
        foreground: typeof sel.foreground === 'string' ? sel.foreground : '',
        cardLayout: sel.cardLayout === true,
        centerContentWidth: centerWidthValue(sel.centerContentWidth),
        translucentSidebar: typeof sel.translucentSidebar === 'string' ? sel.translucentSidebar : 'preset',
        contrast: typeof sel.contrast === 'number' ? sel.contrast : -1,
        backgroundImage: typeof sel.backgroundImage === 'string' ? sel.backgroundImage : '',
        backgroundImageMask: typeof sel.backgroundImageMask === 'number' ? sel.backgroundImageMask : -1,
        backgroundImageBlur: typeof sel.backgroundImageBlur === 'number' ? sel.backgroundImageBlur : -1,
        backgroundImageSize: typeof sel.backgroundImageSize === 'string' ? sel.backgroundImageSize : 'cover',
        backgroundImagePosition: typeof sel.backgroundImagePosition === 'string' ? sel.backgroundImagePosition : 'center',
      }
    }

    // Translate the cordis config (per-mode light/dark blocks) into the
    // studio's single-mode selection. Dark-only paints survive as the
    // `darkCustom` overlay until the user edits something in the studio.
    function selectionFromConfig(cfg) {
      const light = cfg.light || {}
      const dark = cfg.dark || {}
      const sel = normalizeSelection({
        preset: cfg.preset,
        cardLayout: cfg.cardLayout,
        centerContentWidth: cfg.centerContentWidth,
        accent: light.accent,
        background: light.background,
        foreground: light.foreground,
        translucentSidebar: light.translucentSidebar,
        contrast: light.contrast,
        backgroundImage: light.backgroundImage,
        backgroundImageMask: light.backgroundImageMask,
        backgroundImageBlur: light.backgroundImageBlur,
        backgroundImageSize: light.backgroundImageSize,
        backgroundImagePosition: light.backgroundImagePosition,
      })
      const darkCustom = {}
      for (const key of ['accent', 'background', 'foreground']) {
        if (typeof dark[key] === 'string' && dark[key]) darkCustom[key] = dark[key]
      }
      if (typeof dark.translucentSidebar === 'string' && dark.translucentSidebar !== 'preset') darkCustom.translucentSidebar = dark.translucentSidebar
      if (typeof dark.contrast === 'number' && dark.contrast >= 0) darkCustom.contrast = dark.contrast
      // Image options only form a dark overlay when the host config actually
      // gives the dark mode its own wallpaper; otherwise the studio's single
      // value should apply to both modes.
      if (typeof dark.backgroundImage === 'string' && dark.backgroundImage) {
        darkCustom.backgroundImage = dark.backgroundImage
        if (typeof dark.backgroundImageMask === 'number' && dark.backgroundImageMask >= 0) darkCustom.backgroundImageMask = dark.backgroundImageMask
        if (typeof dark.backgroundImageBlur === 'number' && dark.backgroundImageBlur >= 0) darkCustom.backgroundImageBlur = dark.backgroundImageBlur
        if (typeof dark.backgroundImageSize === 'string' && dark.backgroundImageSize) darkCustom.backgroundImageSize = dark.backgroundImageSize
        if (typeof dark.backgroundImagePosition === 'string' && dark.backgroundImagePosition) darkCustom.backgroundImagePosition = dark.backgroundImagePosition
      }
      if (Object.keys(darkCustom).length > 0) sel.darkCustom = darkCustom
      return sel
    }

    exports.apply = function (ctx, config) {
      const slots = ctx.get('slots')
      if (slots === undefined) return

      // Initial selection: localStorage wins; otherwise the host config —
      // passed by shells that still do so, else read from the index.html
      // carrier injected by the host half.
      const stored = loadSelection()
      let initial
      if (stored !== null) {
        initial = normalizeSelection(stored)
      } else {
        const hostConfig = config && (config.preset || config.light || config.dark) ? config : loadHostConfig()
        initial = selectionFromConfig(hostConfig ?? {})
      }

      let currentSelection = initial
      const applySelection = (sel, persist) => {
        currentSelection = sel
        const resolved = resolveSelection(sel)
        ctx.theme.overrideTokens('dsh-card-theme', buildOverride(resolved))
        applyBackdrop(resolved.light, resolved.dark)
        applyCardLayout(sel.cardLayout === true)
        applyCenterWidth(sel.centerContentWidth)
        if (persist !== false) saveSelection(sel)
      }

      // The card stylesheet is static; inject it once so toggling only flips
      // the html attribute. A host-config-derived selection is not persisted,
      // so later edits to cordis.patch.yml still apply on reload; any studio
      // edit wins from then on.
      applyLayoutStyle()
      applySelection(initial, false)

      const ThemeStudio = () => {
        const [sel, setSel] = React.useState(() => currentSelection)
        const [imageBusy, setImageBusy] = React.useState(false)
        const [imageError, setImageError] = React.useState('')
        const firstRender = React.useRef(true)
        React.useEffect(() => {
          if (firstRender.current) {
            firstRender.current = false
            return
          }
          applySelection(sel)
        }, [sel])

        const update = (patch) => setSel((prev) => {
          const next = { ...prev, ...patch }
          // Any studio edit takes over from the host config's dark overlay.
          delete next.darkCustom
          return next
        })

        const chip = (key, active) => React.createElement(
          'button',
          {
            type: 'button',
            key: key,
            onClick: () => update({ preset: key }),
            style: active ? { ...style.chip, ...style.chipActive } : style.chip,
          },
          presets[key].label,
        )

        const select = (value, onChange, options) => React.createElement(
          'select',
          { style: style.select, value: value, onChange: (e) => onChange(e.target.value) },
          options.map((opt) => React.createElement('option', { key: opt.value, value: opt.value }, opt.label)),
        )

        // Custom colors apply to both light and dark; empty string follows the
        // preset. stock (DeepSeek 默认) derives no palette, so color controls
        // are disabled there; card layout and transparency still apply.
        const presetLight = (key) => {
          const p = presets[sel.preset]
          return p && p.light ? (p.light[key] || '') : ''
        }
        const colorDisabled = sel.preset === 'stock'
        const colorRow = (labelText, field, fallback) => React.createElement(
          'div',
          { style: { ...style.row, opacity: colorDisabled ? 0.55 : 1 } },
          React.createElement('div', { style: style.label }, labelText),
          React.createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
            React.createElement('input', {
              type: 'color',
              value: sel[field] || presetLight(fallback) || '#5E81AC',
              disabled: colorDisabled,
              style: { width: '44px', height: '28px', padding: 0, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-1)' },
              onChange: (e) => update({ [field]: e.target.value }),
            }),
            React.createElement('button', {
              type: 'button',
              style: style.chip,
              disabled: colorDisabled || !sel[field],
              onClick: () => update({ [field]: '' }),
            }, '跟随预设'),
          ),
        )

        const imageEnabled = Boolean(sel.backgroundImage)
        const imageMaskValue = sel.backgroundImageMask < 0 ? DEFAULT_IMAGE_MASK : sel.backgroundImageMask
        const imageBlurValue = sel.backgroundImageBlur < 0 ? DEFAULT_IMAGE_BLUR : sel.backgroundImageBlur
        const localImage = imageEnabled && sel.backgroundImage.startsWith('data:')
        const imageSizeOptions = [
          { value: 'cover', label: '铺满（裁切）' },
          { value: 'contain', label: '完整显示' },
          { value: 'auto', label: '原始尺寸' },
        ]
        const imagePositionOptions = [
          { value: 'center', label: '居中' },
          { value: 'center top', label: '顶部' },
          { value: 'center bottom', label: '底部' },
          { value: 'left center', label: '左侧' },
          { value: 'right center', label: '右侧' },
          { value: 'left top', label: '左上' },
          { value: 'right top', label: '右上' },
          { value: 'left bottom', label: '左下' },
          { value: 'right bottom', label: '右下' },
        ]

        const fileInput = React.createElement('input', {
          type: 'file',
          accept: 'image/*',
          style: { display: 'none' },
          onChange: async (e) => {
            const file = e.target.files && e.target.files[0]
            e.target.value = ''
            if (!file) return
            setImageBusy(true)
            setImageError('')
            try {
              const data = await prepareBackgroundImage(file)
              update({ backgroundImage: data })
            } catch (error) {
              setImageError('读取图片失败：' + (error && error.message ? error.message : String(error)))
            } finally {
              setImageBusy(false)
            }
          },
        })

        const imageRow = () => React.createElement(
          'div',
          { style: style.row },
          React.createElement('div', { style: style.label }, '背景图片'),
          React.createElement('input', {
            type: 'text',
            value: localImage ? '' : sel.backgroundImage,
            placeholder: localImage ? '已选择本地图片' : 'https://… 图片地址',
            style: style.input,
            onChange: (e) => update({ backgroundImage: e.target.value }),
          }),
          React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' } },
            React.createElement('label', {
              style: imageBusy ? { ...style.chip, opacity: 0.6 } : style.chip,
            }, imageBusy ? '正在读取…' : '选择本地图片', fileInput),
            React.createElement('button', {
              type: 'button',
              style: style.chip,
              disabled: !imageEnabled,
              onClick: () => { setImageError(''); update({ backgroundImage: '' }) },
            }, '清除图片'),
          ),
          React.createElement('div', { style: { ...style.row, opacity: imageEnabled ? 1 : 0.55 } },
            React.createElement('div', { style: style.label }, '背景遮罩（' + imageMaskValue + '%）'),
            React.createElement('input', {
              type: 'range',
              min: 0,
              max: 100,
              value: imageMaskValue,
              disabled: !imageEnabled,
              style: style.range,
              onChange: (e) => update({ backgroundImageMask: Number(e.target.value) }),
            }),
            React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } },
              React.createElement('button', { type: 'button', style: style.chip, disabled: !imageEnabled || sel.backgroundImageMask < 0, onClick: () => update({ backgroundImageMask: -1 }) }, '恢复默认遮罩'),
            ),
          ),
          React.createElement('div', { style: { ...style.row, opacity: imageEnabled ? 1 : 0.55 } },
            React.createElement('div', { style: style.label }, '模糊（' + imageBlurValue + 'px）'),
            React.createElement('input', {
              type: 'range',
              min: 0,
              max: 60,
              value: imageBlurValue,
              disabled: !imageEnabled,
              style: style.range,
              onChange: (e) => update({ backgroundImageBlur: Number(e.target.value) }),
            }),
            React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } },
              React.createElement('button', { type: 'button', style: style.chip, disabled: !imageEnabled || sel.backgroundImageBlur < 0, onClick: () => update({ backgroundImageBlur: -1 }) }, '恢复默认模糊'),
            ),
          ),
          React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', opacity: imageEnabled ? 1 : 0.55 } },
            React.createElement('div', { style: { ...style.row, flex: '1 1 140px' } },
              React.createElement('div', { style: style.label }, '填充方式'),
              React.createElement('select', {
                style: style.select,
                value: sel.backgroundImageSize,
                disabled: !imageEnabled,
                onChange: (e) => update({ backgroundImageSize: e.target.value }),
              }, imageSizeOptions.map((opt) => React.createElement('option', { key: opt.value, value: opt.value }, opt.label))),
            ),
            React.createElement('div', { style: { ...style.row, flex: '1 1 140px' } },
              React.createElement('div', { style: style.label }, '对齐'),
              React.createElement('select', {
                style: style.select,
                value: sel.backgroundImagePosition,
                disabled: !imageEnabled,
                onChange: (e) => update({ backgroundImagePosition: e.target.value }),
              }, imagePositionOptions.map((opt) => React.createElement('option', { key: opt.value, value: opt.value }, opt.label))),
            ),
          ),
          imageError ? React.createElement('div', { style: { ...style.hint, color: 'var(--dsw-alias-state-error-primary)' } }, imageError) : null,
          React.createElement('div', { style: style.hint }, '图片显示在界面背后：遮罩越大主题底色越浓、文字越清晰；模糊可柔化底层。本地图片会压缩后保存在此浏览器。'),
        )

        return React.createElement(
          'div',
          { style: style.section },
          React.createElement('div', { style: style.row },
            React.createElement('div', { style: style.label }, '主题预设'),
            React.createElement('div', { style: style.chips },
              PRESET_KEYS.map((key) => chip(key, sel.preset === key)),
            ),
          ),
          React.createElement('div', { style: style.row },
            React.createElement('div', { style: style.label }, '卡片布局'),
            React.createElement('div', { style: style.chips },
              React.createElement('button', { type: 'button', style: sel.cardLayout ? style.chip : { ...style.chip, ...style.chipActive }, onClick: () => update({ cardLayout: false }) }, '关闭'),
              React.createElement('button', { type: 'button', style: sel.cardLayout ? { ...style.chip, ...style.chipActive } : style.chip, onClick: () => update({ cardLayout: true }) }, '开启'),
            ),
            React.createElement('div', { style: style.hint }, '左中右三栏各自成为圆角卡片,露出画布间隙;可与任意配色、背景图片同时使用。'),
          ),
          React.createElement('div', { style: style.row },
            React.createElement('div', { style: style.label }, '内容区域宽度（' + (sel.centerContentWidth < 400 ? '跟随默认' : sel.centerContentWidth + 'px') + '）'),
            React.createElement('input', { type: 'range', min: 400, max: 2400, step: 20, value: sel.centerContentWidth < 400 ? 748 : sel.centerContentWidth, style: style.range, onChange: (e) => update({ centerContentWidth: Number(e.target.value) }) }),
            React.createElement('div', { style: style.chips },
              React.createElement('button', { type: 'button', style: sel.centerContentWidth < 400 ? { ...style.chip, ...style.chipActive } : style.chip, onClick: () => update({ centerContentWidth: -1 }) }, '跟随默认'),
              React.createElement('button', { type: 'button', style: sel.centerContentWidth === 640 ? { ...style.chip, ...style.chipActive } : style.chip, onClick: () => update({ centerContentWidth: 640 }) }, '窄 640px'),
              React.createElement('button', { type: 'button', style: sel.centerContentWidth === 748 ? { ...style.chip, ...style.chipActive } : style.chip, onClick: () => update({ centerContentWidth: 748 }) }, '标准 748px'),
              React.createElement('button', { type: 'button', style: sel.centerContentWidth === 920 ? { ...style.chip, ...style.chipActive } : style.chip, onClick: () => update({ centerContentWidth: 920 }) }, '宽 920px'),
              React.createElement('button', { type: 'button', style: sel.centerContentWidth === 1200 ? { ...style.chip, ...style.chipActive } : style.chip, onClick: () => update({ centerContentWidth: 1200 }) }, '超宽 1200px'),
            ),
            React.createElement('div', { style: style.hint }, '中间对话内容列的目标宽度(不含两侧留白)。「跟随默认」= 平台自动 680–920px;超过列宽时内容列占满可用空间。仍可直接拖拽对话区左右边缘的原生调整条,原生值优先。'),
          ),
          colorRow('强调色', 'accent', 'accent'),
          colorRow('背景色', 'background', 'background'),
          colorRow('前景色（文字）', 'foreground', 'foreground'),
          imageRow(),
          React.createElement('div', { style: style.row },
            React.createElement('div', { style: style.label }, '半透明侧边栏'),
            select(sel.translucentSidebar, (v) => update({ translucentSidebar: v }), [
              { value: 'preset', label: '跟随预设' },
              { value: 'on', label: '开启' },
              { value: 'off', label: '关闭' },
            ]),
          ),
          React.createElement('div', { style: style.row },
            React.createElement('div', { style: style.label }, '对比度（' + (sel.contrast < 0 ? '预设' : sel.contrast) + '）'),
            React.createElement('input', {
              type: 'range',
              min: 0,
              max: 100,
              value: sel.contrast < 0 ? 60 : sel.contrast,
              style: style.range,
              onChange: (e) => update({ contrast: Number(e.target.value) }),
            }),
            React.createElement('button', { type: 'button', style: style.chip, onClick: () => update({ contrast: -1 }) }, '恢复预设对比度'),
          ),
          React.createElement('div', { style: style.hint }, '切换即时生效，无需刷新页面；选择保存在本机浏览器，刷新后保持。'),
        )
      }

      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'theme-studio', order: 200, label: '主题工作室' },
        () => React.createElement(ThemeStudio),
      ))
    }

    return module.exports
  },
})
