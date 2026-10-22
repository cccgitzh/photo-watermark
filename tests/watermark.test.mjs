/**
 * tests/watermark.test.mjs — 几何等价性回归
 *
 * 目标：证明重构后的水印引擎与旧版在「同样输入」下绘制出的每一段文字，
 * 其绝对坐标、字体、颜色完全一致。这是“保持原有水印效果不变”的可执行证据。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { legacyDrawText } from './legacy.mjs';
import { createRecordingContext } from './harness.mjs';
import { paintWatermark } from '../js/watermark.js';

const BASE = {
  text: '版权所有 侵权必究',
  color: '#ffffff',
  alpha: 0.3,
  space: 1.5,
  size: 0.8,
  rotate: 45,
  pattern: 'tile',
  count: 1,
  position: 'center',
  fontFamily: '黑体',
  bold: false,
  italic: false,
};

function runLegacy(width, height, config) {
  const harness = createRecordingContext();
  legacyDrawText(harness.ctx, width, height, {
    ...config,
    watermarkPattern: config.pattern,
    watermarkCount: String(config.count),
    watermarkPosition: config.position,
  });
  return harness.glyphs();
}

function runModern(width, height, config) {
  const harness = createRecordingContext();
  paintWatermark(harness.ctx, width, height, config);
  return harness.glyphs();
}

const SIZES = [
  [1200, 800],
  [4000, 3000],
  [600, 400],
  [3000, 120],
  [300, 3000],
  [1920, 1080],
];

const TEXTS = [
  '版权所有 侵权必究',
  '仅供办理XX使用，他用无效',
  '仅用于2024年12月23日身份核验，他用无效',
  'This is a long English sentence used to check text wrapping.',
  '内部资料，请勿外传！！！',
  '身份证号码 110101199001011234',
  '密',
];

test('默认配置：平铺模式逐字坐标与旧版一致', () => {
  for (const [w, h] of SIZES) {
    assert.deepEqual(runModern(w, h, BASE), runLegacy(w, h, BASE), `尺寸 ${w}×${h}`);
  }
});

test('平铺模式：各种文字、字号、间距、角度组合一致', () => {
  for (const text of TEXTS) {
    for (const size of [0.5, 0.8, 1.6, 3]) {
      for (const space of [1, 1.5, 4, 8]) {
        for (const rotate of [-90, 0, 45, 90]) {
          const config = { ...BASE, text, size, space, rotate };
          assert.deepEqual(
            runModern(1600, 1200, config),
            runLegacy(1600, 1200, config),
            `text=${text} size=${size} space=${space} rotate=${rotate}`,
          );
        }
      }
    }
  }
});

test('单个水印：五个位置坐标一致', () => {
  for (const position of ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    for (const [w, h] of SIZES) {
      const config = { ...BASE, pattern: 'single', position };
      assert.deepEqual(runModern(w, h, config), runLegacy(w, h, config), `${position} ${w}×${h}`);
    }
  }
});

test('自定义数量：1~40 个水印的分布一致', () => {
  for (const count of [1, 2, 3, 5, 9, 16, 25, 40]) {
    for (const [w, h] of [[1920, 1080], [1080, 1920], [1200, 1200]]) {
      const config = { ...BASE, pattern: 'custom', count };
      assert.deepEqual(runModern(w, h, config), runLegacy(w, h, config), `count=${count} ${w}×${h}`);
    }
  }
});

test('字体样式：粗体、斜体、各字族的 font 字符串一致', () => {
  for (const fontFamily of ['黑体', '宋体', 'Arial', 'TimesNewRoman']) {
    for (const bold of [false, true]) {
      for (const italic of [false, true]) {
        const config = { ...BASE, fontFamily, bold, italic, pattern: 'single' };
        assert.deepEqual(runModern(1600, 1200, config), runLegacy(1600, 1200, config));
      }
    }
  }
});

test('颜色与透明度：rgba 填充色一致', () => {
  for (const color of ['#ffffff', '#000000', '#e11d48', '#2563eb']) {
    for (const alpha of [0, 0.15, 0.3, 0.55, 1]) {
      const config = { ...BASE, color, alpha, pattern: 'single' };
      assert.deepEqual(runModern(1600, 1200, config), runLegacy(1600, 1200, config));
    }
  }
});

test('空文字回退为默认水印文字', () => {
  const config = { ...BASE, text: '   ', pattern: 'single' };
  const glyphs = runModern(1200, 800, config);
  assert.ok(glyphs.length > 0);
  assert.equal(glyphs[0].text, '水印文字');
  assert.deepEqual(glyphs, runLegacy(1200, 800, config));
});

test('异常参数不会死循环或产生 NaN 坐标', () => {
  const weird = [
    { ...BASE, space: 0, size: 0.5, pattern: 'tile' },
    { ...BASE, rotate: Number.NaN, pattern: 'tile' },
    { ...BASE, pattern: 'custom', count: 0 },
    { ...BASE, pattern: 'custom', count: 5000 },
  ];
  for (const config of weird) {
    const glyphs = runModern(2000, 1500, config);
    for (const glyph of glyphs) {
      assert.ok(Number.isFinite(glyph.absX) && Number.isFinite(glyph.absY), '坐标必须为有限数');
    }
  }
});
