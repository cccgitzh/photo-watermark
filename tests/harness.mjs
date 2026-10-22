/**
 * tests/harness.mjs — 记录型 Canvas 2D 上下文
 *
 * 不做像素渲染，而是记录每次 fillText 的“绝对”坐标（把当前的 save/translate/
 * rotate 变换栈乘进去），用调用序列判断两套算法是否几何等价。
 *
 * measureText 用一套按字符类型估算的推进宽度模拟真实字体，使得换行行为在
 * 两套实现里都能被有意义地触发。
 */

const charAdvance = (ch) => {
  const code = ch.codePointAt(0);
  if (code > 0x2e80) return 1; // CJK / emoji 视为全角
  if (ch === ' ') return 0.28;
  if (/[a-zA-Z0-9]/.test(ch)) return 0.55;
  return 0.45;
};

const multiply = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

const applyPoint = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export function createRecordingContext() {
  const trace = [];
  const stack = [];
  let matrix = [1, 0, 0, 1, 0, 0];
  let font = '10px sans-serif';
  let fillStyle = '#000';

  const fontSize = () => {
    const match = /(\d+(?:\.\d+)?)px/.exec(font);
    return match ? Number.parseFloat(match[1]) : 10;
  };

  const ctx = {
    get font() {
      return font;
    },
    set font(value) {
      font = value;
    },
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(value) {
      fillStyle = value;
    },
    measureText(text) {
      const em = fontSize();
      const width = Array.from(String(text)).reduce((sum, ch) => sum + charAdvance(ch) * em, 0);
      return { width };
    },
    save() {
      stack.push({ matrix, font, fillStyle });
      trace.push({ op: 'save' });
    },
    restore() {
      const state = stack.pop();
      if (state) {
        matrix = state.matrix;
        font = state.font;
        fillStyle = state.fillStyle;
      }
      trace.push({ op: 'restore' });
    },
    translate(x, y) {
      matrix = multiply(matrix, [1, 0, 0, 1, x, y]);
      trace.push({ op: 'translate', x, y });
    },
    rotate(angle) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      matrix = multiply(matrix, [cos, sin, -sin, cos, 0, 0]);
      trace.push({ op: 'rotate', angle });
    },
    fillText(text, x, y) {
      const [absX, absY] = applyPoint(matrix, x, y);
      trace.push({ op: 'fillText', text, x, y, absX, absY, font, fillStyle });
    },
  };

  return {
    ctx,
    trace,
    /** 只保留文字绘制调用（忽略 save/restore/translate 的实现差异） */
    glyphs() {
      return trace
        .filter((item) => item.op === 'fillText')
        .map((item) => ({
          text: item.text,
          absX: Number(item.absX.toFixed(4)),
          absY: Number(item.absY.toFixed(4)),
          font: item.font,
          fillStyle: item.fillStyle,
        }));
    },
    reset() {
      trace.length = 0;
      stack.length = 0;
      matrix = [1, 0, 0, 1, 0, 0];
      font = '10px sans-serif';
      fillStyle = '#000';
    },
  };
}
