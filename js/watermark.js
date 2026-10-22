/**
 * watermark.js — 水印绘制引擎（纯函数式，不依赖 DOM 结构）
 *
 * 几何计算与旧版逐行等价：字号/行高/间距/平铺步长/定位点全部沿用原公式，
 * 因此默认参数下的视觉效果与原版一致。本模块只做两件事：
 *   1. 用一次 measureText 预算出每行宽度，消灭原先在平铺双层循环里的重复测量；
 *   2. 增加数值兜底，避免异常参数导致死循环或 NaN 坐标。
 */

import { wrapText } from './text-layout.js';

export const FALLBACK_TEXT = '水印文字';

/** 平铺模式的安全上限，防止异常参数把主线程锁死。 */
const MAX_TILES = 20000;

/** 与原版 makeStyle 等价：把 #rrggbb + 透明度拼成 rgba()。 */
export function toRgba(hex, alpha) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!match) return `rgba(255,255,255,${alpha})`;
  const r = Number.parseInt(match[1], 16);
  const g = Number.parseInt(match[2], 16);
  const b = Number.parseInt(match[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** 与原版 font 字符串格式保持一致（style weight size family）。 */
export function toFontString(config, textSize) {
  const style = config.italic ? 'italic' : 'normal';
  const weight = config.bold ? 'bold' : 'normal';
  return `${style} ${weight} ${textSize}px "${config.fontFamily}"`;
}

function measureWidth(ctx, str) {
  const width = ctx.measureText(str).width;
  return Number.isFinite(width) ? width : 0;
}

/**
 * 在给定画布上绘制水印。
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width 目标画布像素宽
 * @param {number} height 目标画布像素高
 * @param {object} config 归一化后的配置
 */
export function paintWatermark(ctx, width, height, config) {
  if (!ctx || !(width > 0) || !(height > 0)) return;

  const text = (config.text || '').trim() || FALLBACK_TEXT;

  // 与原版一致：字号随画布对角线缩放，并保留 15 / 12 的下限。
  const diagonal = Math.sqrt(width * width + height * height) || 1000;
  const textSize = Math.max(12, config.size * Math.max(15, diagonal / 25));

  const font = toFontString(config, textSize);
  const fillStyle = toRgba(config.color, Number(config.alpha.toFixed(3)));

  ctx.save();
  ctx.font = font;
  ctx.fillStyle = fillStyle;

  // 与原版一致：单行最大宽度限制在 [100, 500]。
  const maxTextWidth = Math.min(Math.max(100, width * 0.8), 500);
  const lines = wrapText(text, maxTextWidth, (s) => measureWidth(ctx, s));
  const lineWidths = lines.map((line) => measureWidth(ctx, line));
  const maxLineWidth = Math.max(...lineWidths);
  const lineHeight = textSize * 1.2;
  const totalHeight = lineHeight * lines.length;

  const lineOffset = (index) => (index - (lines.length - 1) / 2) * lineHeight;

  /** 在 (x, y) 处以 angle 弧度旋转绘制整段文字（中心对齐）。 */
  const drawBlock = (x, y, angle) => {
    ctx.save();
    ctx.translate(x, y);
    if (angle) ctx.rotate(angle);
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], -lineWidths[i] / 2, lineOffset(i) + textSize / 2);
    }
    ctx.restore();
  };

  const angleDeg = Number.isFinite(config.rotate) ? config.rotate : 0;
  const angle = (angleDeg * Math.PI) / 180;

  try {
    if (config.pattern === 'tile') {
      const xStep = maxLineWidth + measureWidth(ctx, '啊');
      const yStep = config.space * (totalHeight + textSize);
      if (!(xStep > 0) || !(yStep > 0)) return;

      const cols = Math.ceil(diagonal / xStep);
      const rows = Math.ceil(diagonal / yStep);
      if (cols * rows > MAX_TILES) {
        console.warn('[watermark] 平铺数量异常，已跳过绘制', { cols, rows });
        return;
      }

      const startX = -diagonal / 2;
      const startY = -diagonal / 2;

      ctx.translate(width / 2, height / 2);
      ctx.rotate(angle);
      for (let i = 0; i <= cols; i++) {
        const x = startX + i * xStep;
        for (let j = 0; j <= rows; j++) {
          const y = startY + j * yStep;
          for (let k = 0; k < lines.length; k++) {
            ctx.fillText(lines[k], x - lineWidths[k] / 2, y + lineOffset(k) + textSize / 2);
          }
        }
      }
      return;
    }

    const padding = Math.min(width, height) * 0.1;
    const positions = [];

    if (config.pattern === 'single' || config.count === 1) {
      switch (config.position) {
        case 'top-left':
          positions.push([maxLineWidth / 2 + padding, totalHeight / 2 + padding]);
          break;
        case 'top-right':
          positions.push([width - maxLineWidth / 2 - padding, totalHeight / 2 + padding]);
          break;
        case 'bottom-left':
          positions.push([maxLineWidth / 2 + padding, height - totalHeight / 2 - padding]);
          break;
        case 'bottom-right':
          positions.push([width - maxLineWidth / 2 - padding, height - totalHeight / 2 - padding]);
          break;
        case 'center':
        default:
          positions.push([width / 2, height / 2]);
      }
    } else {
      const count = Math.min(1000, Math.max(1, Math.round(config.count)));
      const cols = Math.ceil(Math.sqrt((count * width) / height));
      const rows = Math.ceil(count / cols);
      const xStep = (width - 2 * padding) / (cols - 1 || 1);
      const yStep = (height - 2 * padding) / (rows - 1 || 1);

      let placed = 0;
      for (let i = 0; i < cols && placed < count; i++) {
        for (let j = 0; j < rows && placed < count; j++) {
          positions.push([padding + i * xStep, padding + j * yStep]);
          placed++;
        }
      }
    }

    for (const [x, y] of positions) drawBlock(x, y, angle);
  } finally {
    ctx.restore();
  }
}
