/**
 * state.js — 水印配置的唯一数据源
 *
 * 所有可调参数的默认值、取值范围、归一化规则集中在此，
 * UI 只负责把输入写进 store，渲染层只负责读。
 */

/** 默认值必须与旧版保持一致，保证默认输出效果不变。 */
export const DEFAULT_CONFIG = Object.freeze({
  text: '版权所有 侵权必究',
  color: '#ffffff',
  alpha: 0.3,
  space: 1.5,
  size: 0.8,
  rotate: 45,
  pattern: 'tile', // tile | single | custom
  count: 1,
  position: 'center', // center | top-left | top-right | bottom-left | bottom-right
  fontFamily: '黑体',
  bold: false,
  italic: false,
});

export const PATTERNS = Object.freeze(['tile', 'single', 'custom']);
export const POSITIONS = Object.freeze(['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right']);
export const MAX_TEXT_LENGTH = 100;

const RANGES = Object.freeze({
  alpha: [0, 1],
  space: [1, 8],
  size: [0.5, 3],
  rotate: [-90, 90],
  count: [1, 100],
});

const STORAGE_KEY = 'pw-config-v1';

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

const toNumber = (value, fallback) => {
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * 把任意来源（localStorage、DOM、URL）的输入收敛成合法配置。
 * 任何非法字段都回退到默认值，保证渲染层永远拿到可用的数据。
 */
export function sanitizeConfig(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const cfg = { ...DEFAULT_CONFIG };

  if (typeof src.text === 'string') {
    cfg.text = src.text.slice(0, MAX_TEXT_LENGTH);
  }

  if (typeof src.color === 'string' && /^#[0-9a-f]{6}$/i.test(src.color.trim())) {
    cfg.color = src.color.trim().toLowerCase();
  }

  for (const [key, [min, max]] of Object.entries(RANGES)) {
    cfg[key] = clamp(toNumber(src[key], DEFAULT_CONFIG[key]), min, max);
  }
  cfg.count = Math.round(cfg.count);

  if (PATTERNS.includes(src.pattern)) cfg.pattern = src.pattern;
  if (POSITIONS.includes(src.position)) cfg.position = src.position;
  if (typeof src.fontFamily === 'string' && src.fontFamily.trim()) {
    cfg.fontFamily = src.fontFamily.trim().slice(0, 40);
  }

  cfg.bold = src.bold === true;
  cfg.italic = src.italic === true;

  return cfg;
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return sanitizeConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

export class ConfigStore {
  #state;
  #listeners = new Set();
  #saveTimer = 0;

  constructor(initial) {
    this.#state = sanitizeConfig(initial ?? loadPersisted() ?? DEFAULT_CONFIG);
  }

  get state() {
    return this.#state;
  }

  /** 增量更新；只有真正变化的字段才会触发通知。 */
  patch(partial) {
    const next = sanitizeConfig({ ...this.#state, ...partial });
    const changed = Object.keys(next).filter((key) => next[key] !== this.#state[key]);
    if (changed.length === 0) return changed;

    this.#state = next;
    for (const listener of this.#listeners) listener(next, changed);
    this.#schedulePersist();
    return changed;
  }

  reset() {
    return this.patch(DEFAULT_CONFIG);
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #schedulePersist() {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#state));
      } catch {
        /* 隐私模式下 localStorage 可能不可写，忽略即可 */
      }
    }, 300);
  }
}
