/**
 * controls.js — 把侧栏控件与 ConfigStore 双向绑定
 *
 * 单向数据流：控件 → store.patch() → 订阅者（图片重绘）→ sync() 回写控件状态。
 * 这样任何参数只有一个来源，避免旧版“从 DOM 里逐次读值”造成的状态漂移。
 */

import { MAX_TEXT_LENGTH } from './state.js';

const NUMBER_FORMAT = {
  alpha: (v) => v.toFixed(2),
  size: (v) => v.toFixed(2),
  space: (v) => v.toFixed(1),
  rotate: (v) => `${Math.round(v)}°`,
};

/** 让 role="radiogroup" 支持方向键切换（键盘可用的基本要求）。 */
function bindRadioKeys(group, selector, onPick) {
  group.addEventListener('keydown', (event) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(event.key)) return;

    const items = [...group.querySelectorAll(selector)];
    const current = items.indexOf(document.activeElement);
    if (current < 0) return;

    event.preventDefault();
    let next = current;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % items.length;
    else if (event.key === 'Home') next = 0;
    else next = items.length - 1;

    items[next].focus();
    onPick(items[next]);
  });
}

export function bindControls(store) {
  const $ = (id) => document.getElementById(id);

  const text = $('text');
  const textCount = $('textCount');
  const textPresets = $('textPresets');
  const patternSeg = $('patternSeg');
  const countField = $('countField');
  const countInput = $('count');
  const positionField = $('positionField');
  const positionGrid = $('positionGrid');
  const fontFamily = $('fontFamily');
  const boldToggle = $('boldToggle');
  const italicToggle = $('italicToggle');
  const colorInput = $('color');
  const swatches = $('colorSwatches');
  const ranges = {
    alpha: $('alpha'),
    size: $('size'),
    space: $('space'),
    rotate: $('rotate'),
  };
  const outputs = {
    alpha: $('outAlpha'),
    size: $('outSize'),
    space: $('outSpace'),
    rotate: $('outRotate'),
  };

  /* ---------- 控件 → store ---------- */

  text.addEventListener('input', () => {
    const value = text.value.slice(0, MAX_TEXT_LENGTH);
    if (text.value !== value) text.value = value;
    textCount.textContent = String(value.length);
    store.patch({ text: value });
  });

  textPresets.addEventListener('click', (event) => {
    const btn = event.target.closest('.chip');
    if (!btn) return;
    text.value = btn.dataset.text || '';
    textCount.textContent = String(text.value.length);
    store.patch({ text: text.value });
    text.focus();
  });

  patternSeg.addEventListener('click', (event) => {
    const btn = event.target.closest('.seg');
    if (!btn) return;
    store.patch({ pattern: btn.dataset.pattern });
  });
  bindRadioKeys(patternSeg, '.seg', (btn) => store.patch({ pattern: btn.dataset.pattern }));

  countInput.addEventListener('input', () => {
    const value = countInput.valueAsNumber;
    if (Number.isFinite(value) && value >= 1) store.patch({ count: value });
  });

  countInput.addEventListener('change', () => {
    const value = Math.min(100, Math.max(1, Math.round(countInput.valueAsNumber || 1)));
    countInput.value = String(value);
    store.patch({ count: value });
  });

  positionGrid.addEventListener('click', (event) => {
    const btn = event.target.closest('.pos');
    if (!btn) return;
    store.patch({ position: btn.dataset.position });
  });
  bindRadioKeys(positionGrid, '.pos', (btn) => store.patch({ position: btn.dataset.position }));

  fontFamily.addEventListener('change', () => store.patch({ fontFamily: fontFamily.value }));

  boldToggle.addEventListener('click', () => store.patch({ bold: !store.state.bold }));
  italicToggle.addEventListener('click', () => store.patch({ italic: !store.state.italic }));

  colorInput.addEventListener('input', () => store.patch({ color: colorInput.value }));

  swatches.addEventListener('click', (event) => {
    const btn = event.target.closest('.swatch');
    if (!btn) return;
    store.patch({ color: btn.dataset.color });
  });

  for (const [key, input] of Object.entries(ranges)) {
    input.addEventListener('input', () => {
      store.patch({ [key]: input.valueAsNumber });
    });
  }

  /* ---------- store → 控件 ---------- */

  const sync = (state) => {
    if (text.value !== state.text) text.value = state.text;
    textCount.textContent = String(state.text.length);

    for (const btn of patternSeg.querySelectorAll('.seg')) {
      btn.setAttribute('aria-checked', String(btn.dataset.pattern === state.pattern));
    }
    countField.hidden = state.pattern !== 'custom';
    positionField.hidden = state.pattern !== 'single';

    if (document.activeElement !== countInput) countInput.value = String(state.count);
    for (const btn of positionGrid.querySelectorAll('.pos')) {
      btn.setAttribute('aria-checked', String(btn.dataset.position === state.position));
    }

    if (fontFamily.value !== state.fontFamily) fontFamily.value = state.fontFamily;
    boldToggle.setAttribute('aria-pressed', String(state.bold));
    italicToggle.setAttribute('aria-pressed', String(state.italic));

    if (colorInput.value !== state.color) colorInput.value = state.color;
    for (const btn of swatches.querySelectorAll('.swatch')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.color === state.color));
    }

    for (const [key, input] of Object.entries(ranges)) {
      if (document.activeElement !== input) input.value = String(state[key]);
      outputs[key].textContent = NUMBER_FORMAT[key](Number(state[key]));
    }
  };

  sync(store.state);
  store.subscribe(sync);

  return { sync };
}
