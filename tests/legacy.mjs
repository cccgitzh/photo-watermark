/**
 * tests/legacy.mjs — 旧版（v1）绘制算法的等效移植，仅用于回归对比。
 *
 * 逻辑逐行照搬自原仓库 js/script.js 的 wrapText / drawText，
 * 只把 DOM 依赖（canvas 元素、input 元素）换成显式参数，
 * 以便在 Node 里用记录型 mock context 跑出与新版一致的调用序列。
 */

const isPunctuation = (str) => /^[，。！？；：、,.!?;:\s]$/.test(str);

export function legacyWrapText(text, maxWidth, ctx) {
  if (!text || typeof text !== 'string') return ['水印文字'];
  maxWidth = Math.max(50, maxWidth || 100);

  const measureWidth = (str) => ctx.measureText(str).width;

  const splitPattern =
    /([，。！？；：、,.!?;:\s]|[0-9-/年月日]+|[a-zA-Z]+|[\u4e00-\u9fa5]+|[^\u4e00-\u9fa5a-zA-Z0-9\s])/g;
  const segments = text.match(splitPattern) || [];

  const lines = [];
  let currentLine = '';

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]?.trim() || '';
    if (!segment) continue;

    const nextSegment = segments[i + 1]?.trim() || '';
    const isNextPunctuation = isPunctuation(nextSegment);

    if (isPunctuation(segment)) {
      if (!currentLine && lines.length > 0) {
        const lastLine = lines[lines.length - 1];
        const testLastLine = lastLine + segment;
        if (measureWidth(testLastLine) <= maxWidth) {
          lines[lines.length - 1] = testLastLine;
        } else {
          currentLine = segment;
        }
      } else {
        currentLine += segment;
      }
      continue;
    }

    const testLine = currentLine + segment + (isNextPunctuation ? nextSegment : '');
    const testWidth = measureWidth(testLine);

    if (testWidth <= maxWidth) {
      currentLine += segment;
      if (isNextPunctuation) {
        currentLine += nextSegment;
        i++;
      }
    } else if (currentLine) {
      if (!isPunctuation(currentLine)) {
        lines.push(currentLine);
        currentLine = segment;
        if (isNextPunctuation && measureWidth(segment + nextSegment) <= maxWidth) {
          currentLine += nextSegment;
          i++;
        }
      } else {
        currentLine += segment;
      }
    } else if (segment.length <= 4) {
      lines.push(segment);
      currentLine = '';
    } else {
      let tempLine = '';
      for (const char of segment) {
        const testTemp = tempLine + char;
        if (measureWidth(testTemp) <= maxWidth) {
          tempLine = testTemp;
        } else if (tempLine) {
          if (isPunctuation(char)) {
            if (measureWidth(tempLine + char) <= maxWidth * 1.1) {
              tempLine += char;
            } else {
              lines.push(tempLine);
              tempLine = char;
            }
          } else {
            lines.push(tempLine);
            tempLine = char;
          }
        } else {
          tempLine = char;
        }
      }
      if (tempLine) currentLine = tempLine;
    }
  }

  if (currentLine) {
    if (!isPunctuation(currentLine) || lines.length === 0) {
      lines.push(currentLine);
    } else if (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      const testLastLine = lastLine + currentLine;
      if (measureWidth(testLastLine) <= maxWidth * 1.1) {
        lines[lines.length - 1] = testLastLine;
      } else {
        lines.push(currentLine);
      }
    }
  }

  return lines.length > 0 ? lines : ['水印文字'];
}

export function legacyMakeStyle(color, alpha) {
  const match = color.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  return (
    'rgba(' +
    parseInt(match[1], 16) + ',' +
    parseInt(match[2], 16) + ',' +
    parseInt(match[3], 16) + ',' +
    alpha + ')'
  );
}

/** 原版 drawText 的绘制部分（不含 DOM 与 try/catch）。 */
export function legacyDrawText(ctx, width, height, config) {
  const pattern = config.watermarkPattern || 'tile';
  const position = config.watermarkPosition || 'center';
  const count = Math.max(1, parseInt(config.watermarkCount, 10) || 1);

  const fontFamily = config.fontFamily || '黑体';
  const fontWeight = config.bold ? 'bold' : 'normal';
  const fontStyle = config.italic ? 'italic' : 'normal';

  const diagonal = Math.sqrt(width * width + height * height) || 1000;
  const textSize = Math.max(12, (config.size || 1) * Math.max(15, diagonal / 25));

  ctx.font = `${fontStyle} ${fontWeight} ${textSize}px "${fontFamily}"`;
  ctx.fillStyle = legacyMakeStyle(config.color, config.alpha);

  const text = config.text?.trim() || '水印文字';
  const maxWidth = Math.min(Math.max(100, width * 0.8), 500);

  const lines = legacyWrapText(text, maxWidth, ctx);
  const lineHeight = textSize * 1.2;
  const totalHeight = lineHeight * lines.length;

  const drawSingleWatermark = (x, y, angle) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((angle * Math.PI) / 180);
    lines.forEach((line, index) => {
      const lineY = (index - (lines.length - 1) / 2) * lineHeight;
      const lineWidth = ctx.measureText(line).width;
      ctx.fillText(line, -lineWidth / 2, lineY + textSize / 2);
    });
    ctx.restore();
  };

  if (pattern === 'tile') {
    ctx.save();
    ctx.translate(width / 2, height / 2);
    const angle = parseFloat(config.rotate);
    ctx.rotate((angle * Math.PI) / 180);

    const maxLineWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));
    const xStep = maxLineWidth + ctx.measureText('啊').width;
    const yStep = config.space * (totalHeight + textSize);
    const rectWidth = diagonal;
    const rectHeight = diagonal;
    const startX = -rectWidth / 2;
    const startY = -rectHeight / 2;

    const cols = Math.ceil(rectWidth / xStep);
    const rows = Math.ceil(rectHeight / yStep);

    for (let i = 0; i <= cols; i++) {
      for (let j = 0; j <= rows; j++) {
        const x = startX + i * xStep;
        const y = startY + j * yStep;
        lines.forEach((line, index) => {
          const lineY = y + (index - (lines.length - 1) / 2) * lineHeight;
          const lineWidth = ctx.measureText(line).width;
          ctx.fillText(line, x - lineWidth / 2, lineY + textSize / 2);
        });
      }
    }
    ctx.restore();
    return;
  }

  const positions = [];
  const padding = Math.min(width, height) * 0.1;

  if (pattern === 'single' || count === 1) {
    const maxLineWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));
    switch (position) {
      case 'center':
        positions.push([width / 2, height / 2]);
        break;
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
      default:
        positions.push([width / 2, height / 2]);
    }
  } else {
    const cols = Math.ceil(Math.sqrt((count * width) / height));
    const rows = Math.ceil(count / cols);
    const xStep = (width - 2 * padding) / (cols - 1 || 1);
    const yStep = (height - 2 * padding) / (rows - 1 || 1);

    let currentCount = 0;
    for (let i = 0; i < cols && currentCount < count; i++) {
      for (let j = 0; j < rows && currentCount < count; j++) {
        positions.push([padding + i * xStep, padding + j * yStep]);
        currentCount++;
      }
    }
  }

  const angle = parseFloat(config.rotate);
  positions.forEach(([x, y]) => drawSingleWatermark(x, y, angle));
}
