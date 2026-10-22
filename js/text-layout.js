/**
 * text-layout.js — 水印文字换行
 *
 * 与旧版 wrapText 的断行规则完全一致（同一套分段正则、同一套空格/标点合并、
 * 同样的 maxWidth*1.1 容差），只是去掉了逐字符 try/catch 与重复测量，
 * 因此换行结果不变，性能更好。
 */

const SEGMENT_PATTERN =
  /([，。！？；：、,.!?;:\s]|[0-9-/年月日]+|[a-zA-Z]+|[\u4e00-\u9fa5]+|[^\u4e00-\u9fa5a-zA-Z0-9\s])/g;

const PUNCTUATION_PATTERN = /^[，。！？；：、,.!?;:\s]$/;

const isPunctuation = (str) => PUNCTUATION_PATTERN.test(str);

/**
 * @param {string} text 原始文字
 * @param {number} maxWidth 单行最大宽度（px）
 * @param {(s: string) => number} measure 文本测量函数（通常为 ctx.measureText().width）
 * @returns {string[]} 行数组
 */
export function wrapText(text, maxWidth, measure) {
  if (typeof text !== 'string' || text.length === 0) return ['水印文字'];

  const limit = Math.max(50, Number.isFinite(maxWidth) ? maxWidth : 100);

  // 同一次排版中字符串重复度很高，缓存测量结果可显著减少 measureText 调用。
  const cache = new Map();
  const width = (str) => {
    let w = cache.get(str);
    if (w === undefined) {
      try {
        w = measure(str);
        if (!Number.isFinite(w)) w = Number.POSITIVE_INFINITY;
      } catch {
        w = Number.POSITIVE_INFINITY;
      }
      cache.set(str, w);
    }
    return w;
  };

  const segments = text.match(SEGMENT_PATTERN) || [];
  const lines = [];
  let currentLine = '';

  for (let i = 0; i < segments.length; i++) {
    const segment = (segments[i] || '').trim();
    if (!segment) continue;

    const nextSegment = (segments[i + 1] || '').trim();
    const isNextPunctuation = isPunctuation(nextSegment);

    // 段首标点：尽量回溯贴到上一行末尾，避免行首出现标点。
    if (isPunctuation(segment)) {
      if (!currentLine && lines.length > 0) {
        const lastLine = lines[lines.length - 1] + segment;
        if (width(lastLine) <= limit) {
          lines[lines.length - 1] = lastLine;
        } else {
          currentLine = segment;
        }
      } else {
        currentLine += segment;
      }
      continue;
    }

    const testLine = currentLine + segment + (isNextPunctuation ? nextSegment : '');

    if (width(testLine) <= limit) {
      currentLine += segment;
      if (isNextPunctuation) {
        currentLine += nextSegment;
        i++;
      }
      continue;
    }

    if (currentLine) {
      if (!isPunctuation(currentLine)) {
        lines.push(currentLine);
        currentLine = segment;
        if (isNextPunctuation && width(segment + nextSegment) <= limit) {
          currentLine += nextSegment;
          i++;
        }
      } else {
        currentLine += segment;
      }
      continue;
    }

    // 单段本身就超宽：短段直接成行，长段按字符硬切。
    if (segment.length <= 4) {
      lines.push(segment);
      currentLine = '';
      continue;
    }

    let tempLine = '';
    for (const char of segment) {
      if (width(tempLine + char) <= limit) {
        tempLine += char;
        continue;
      }
      if (tempLine) {
        if (isPunctuation(char) && width(tempLine + char) <= limit * 1.1) {
          tempLine += char;
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

  if (currentLine) {
    if (!isPunctuation(currentLine) || lines.length === 0) {
      lines.push(currentLine);
    } else {
      const lastLine = lines[lines.length - 1] + currentLine;
      if (width(lastLine) <= limit * 1.1) {
        lines[lines.length - 1] = lastLine;
      } else {
        lines.push(currentLine);
      }
    }
  }

  return lines.length > 0 ? lines : ['水印文字'];
}
