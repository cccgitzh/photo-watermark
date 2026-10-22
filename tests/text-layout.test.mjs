/**
 * tests/text-layout.test.mjs — 换行规则回归
 *
 * 用旧版 wrapText 作基准，覆盖中英文混排、标点、日期、超长串、空串等，
 * 逐行比对换行结果，确保重构没有改变断行行为。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { legacyWrapText } from './legacy.mjs';
import { createRecordingContext } from './harness.mjs';
import { wrapText } from '../js/text-layout.js';

const CORPUS = [
  '版权所有 侵权必究',
  '仅供办理XX使用，他用无效',
  '仅用于2024年12月23日身份核验，他用无效',
  '该证件仅供XX查看，不得他用',
  '内部资料，请勿外传！！！',
  '复印件与原件相符',
  'This is a fairly long English sentence that should wrap several times.',
  '身份证号码 110101199001011234',
  '某某科技有限公司  2024-12-23  Beijing China',
  '密',
  '禁',
  '，，，，',
  '。',
  '！？；：、',
  '2024年12月23日',
  '一二三四五六七八九十一二三四五六七八九十',
  'A1B2C3D4E5F6G7H8I9J0',
  '水印水印水印水印水印水印水印水印水印水印水印水印水印水印水印水印水印水印水印水印',
  '  前后都有空格  ',
  '混合 test 文字 123 号',
];

test('wrapText 与旧版逐行一致', () => {
  for (const text of CORPUS) {
    for (const maxWidth of [100, 160, 240, 360, 500]) {
      for (const em of [12, 30, 96, 200]) {
        const harness = createRecordingContext();
        harness.ctx.font = `normal normal ${em}px "黑体"`;
        const expected = legacyWrapText(text, maxWidth, harness.ctx);
        const actual = wrapText(text, maxWidth, (s) => harness.ctx.measureText(s).width);
        assert.deepEqual(actual, expected, `text=${JSON.stringify(text)} maxWidth=${maxWidth} em=${em}`);
      }
    }
  }
});

test('空输入回退为默认文字', () => {
  const measure = (s) => s.length * 10;
  assert.deepEqual(wrapText('', 100, measure), ['水印文字']);
  assert.deepEqual(wrapText(null, 100, measure), ['水印文字']);
  assert.deepEqual(wrapText(undefined, 100, measure), ['水印文字']);
});

test('测量函数抛错时不会中断排版', () => {
  const lines = wrapText('水印文字测试', 100, () => {
    throw new Error('boom');
  });
  assert.ok(Array.isArray(lines) && lines.length > 0);
});
