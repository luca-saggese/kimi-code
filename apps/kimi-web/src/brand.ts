// apps/kimi-web/src/brand.ts
// White-label brand configuration loader.
// Fetches /brand.config.json on startup and provides reactive brand values
// to the entire app. Uses `reactive()` so properties are accessed directly,
// no `.value` unwrap needed — works uniformly in scripts, templates, and .ts.

import { reactive, shallowRef } from 'vue';

/** Logo configuration from brand.config.json */
export interface BrandLogo {
  type: 'kimi-eyes' | 'custom-svg' | 'custom-image';
  ariaLabel: string;
  src?: string;
  width?: number;
  height?: number;
}

/** Accent color pair */
export interface BrandAccent {
  light: string;
  dark: string;
}

/** Resolved brand configuration */
export interface BrandConfig {
  productName: string;
  productNameShort: string;
  htmlTitle: string;
  favicon: string;
  accentColor: BrandAccent;
  notificationPrefix: string;
  daemonName: string;
  clientName: string;
  filePrefix: string;
  storagePrefix: string;
  loginHint: string;
  loginHintZh: string;
  logo: BrandLogo;
}

const DEFAULTS: BrandConfig = {
  productName: 'Kimi Code',
  productNameShort: 'Kimi',
  htmlTitle: 'Kimi Code Web',
  favicon: '/favicon.ico',
  accentColor: { light: '#1783ff', dark: '#58a6ff' },
  notificationPrefix: 'Kimi Code',
  daemonName: 'kimi-code',
  clientName: 'kimi-code-web',
  filePrefix: 'kimi-web',
  storagePrefix: 'kimi-web',
  loginHint: 'Please upgrade kimi-code and try again',
  loginHintZh: '请升级 kimi-code 后重试',
  logo: { type: 'kimi-eyes' as const, ariaLabel: 'Kimi Code' },
};

/** Reactive brand config. Defaults applied immediately; merged on fetch. */
export const brand = reactive<BrandConfig>({ ...DEFAULTS });

/** Whether /brand.config.json has been fetched (defaults may apply). */
export const brandLoaded = shallowRef(false);

let _fetchPromise: Promise<BrandConfig> | null = null;

/** Fetch and merge /brand.config.json. Call once at app startup. */
export async function initBrand(): Promise<BrandConfig> {
  if (_fetchPromise) return _fetchPromise;

  _fetchPromise = fetch('/brand.config.json', { cache: 'no-cache' })
    .then((res) => {
      if (!res.ok) throw new Error(`brand.config.json ${res.status}`);
      return res.json() as Promise<Partial<BrandConfig>>;
    })
    .then((partial) => {
      const merged = { ...DEFAULTS, ...partial } as BrandConfig;
      if (partial.accentColor) {
        merged.accentColor = { ...DEFAULTS.accentColor, ...partial.accentColor };
      }
      if (partial.logo) {
        merged.logo = { ...DEFAULTS.logo, ...partial.logo } as BrandLogo;
      }
      Object.assign(brand, merged);
      brandLoaded.value = true;
      return merged;
    })
    .catch(() => {
      brandLoaded.value = true;
      return DEFAULTS;
    });

  return _fetchPromise;
}

// ------ Accent color injection ------

let _brandStyleEl: HTMLStyleElement | null = null;

function ensureBrandStyleElement(): void {
  if (_brandStyleEl) return;
  _brandStyleEl = document.createElement('style');
  _brandStyleEl.id = 'brand-accent-overrides';
  document.head.appendChild(_brandStyleEl);
}

/**
 * Inject a <style> block that overrides accent-color CSS custom properties
 * with the brand accent values. Appended after the main stylesheet so it wins
 * the cascade. The mono accent (`html[data-accent="mono"]`) has higher
 * specificity and still takes precedence.
 */
export function applyBrandAccent(): void {
  const light = brand.accentColor.light;
  const dark = brand.accentColor.dark;

  const lightHover = adjustBrightness(light, -12);
  const lightSoft = hexToRgba(light, 0.08);
  const lightBd = hexToRgba(light, 0.2);

  const darkHover = adjustBrightness(dark, 8);
  const darkSoft = hexToRgba(dark, 0.14);
  const darkBd = hexToRgba(dark, 0.28);

  ensureBrandStyleElement();
  _brandStyleEl!.textContent = `
    :root {
      --accent-primary: ${light};
      --blue: ${light};
      --color-accent: ${light};
      --logo: ${light};
      --blue2: ${lightHover};
      --color-accent-hover: ${lightHover};
      --soft: ${lightSoft};
      --color-accent-soft: ${lightSoft};
      --bd: ${lightBd};
      --color-accent-bd: ${lightBd};
      --color-info: ${light};
    }
    html[data-color-scheme="dark"] {
      --accent-primary: ${dark};
      --blue: ${dark};
      --color-accent: ${dark};
      --logo: ${dark};
      --blue2: ${darkHover};
      --color-accent-hover: ${darkHover};
      --soft: ${darkSoft};
      --color-accent-soft: ${darkSoft};
      --bd: ${darkBd};
      --color-accent-bd: ${darkBd};
      --color-info: ${dark};
    }
    @media (prefers-color-scheme: dark) {
      html[data-color-scheme="system"] {
        --accent-primary: ${dark};
        --blue: ${dark};
        --color-accent: ${dark};
        --logo: ${dark};
        --blue2: ${darkHover};
        --color-accent-hover: ${darkHover};
        --soft: ${darkSoft};
        --color-accent-soft: ${darkSoft};
        --bd: ${darkBd};
        --color-accent-bd: ${darkBd};
        --color-info: ${dark};
      }
    }
  `;
}

// ------ Color utilities ------

function adjustBrightness(hex: string, amount: number): string {
  const r = clamp(Math.round(parseInt(hex.slice(1, 3), 16) + amount), 0, 255);
  const g = clamp(Math.round(parseInt(hex.slice(3, 5), 16) + amount), 0, 255);
  const b = clamp(Math.round(parseInt(hex.slice(5, 7), 16) + amount), 0, 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
