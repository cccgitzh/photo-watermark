/**
 * items.js — 图片条目：解码、卡片渲染、全分辨率导出
 *
 * 关键设计：卡片上只保留一份“按长边缩放后的底图”，绘制时用画布变换把坐标系
 * 缩放回原始像素尺寸，再调用水印引擎。因此卡片预览与全分辨率导出的水印几何
 * 完全同构（所见即所得），同时避免了旧版“每张图常驻一张原尺寸 canvas”
 * 带来的几十 MB 级内存占用。
 */

import { paintWatermark } from './watermark.js';

/** 卡片底图长边上限（设备像素）。 */
export const CARD_MAX_EDGE = 1200;
/** 灯箱预览长边上限。 */
export const PREVIEW_MAX_EDGE = 2560;

const SUPPORTED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

const SUPPORTED_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico']);

export const SUPPORTED_LABEL = 'JPG / PNG / GIF / WebP / BMP / ICO';

export function getExtension(name) {
  const idx = String(name).lastIndexOf('.');
  return idx > 0 ? String(name).slice(idx + 1).toLowerCase() : '';
}

/** 部分浏览器对 .ico / .bmp 给出的 type 为空，用扩展名兜底。 */
export function isSupportedImage(file) {
  if (!file || typeof file.name !== 'string') return false;
  if (SUPPORTED_MIME.has(file.type)) return true;
  return SUPPORTED_EXT.has(getExtension(file.name));
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** 生成安全文件名：去掉路径分隔符、控制字符与 Windows 保留名。 */
export function safeFileName(name, fallback = 'image') {
  const base = String(name || '')
    .replace(/\.[^./\\]+$/, '')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  if (!base || WINDOWS_RESERVED.test(base)) return fallback;
  return base.slice(0, 80);
}

export function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

async function loadViaImageElement(source) {
  const url = URL.createObjectURL(source);
  try {
    const img = new Image();
    img.decoding = 'async';
    if (typeof img.decode === 'function') {
      img.src = url;
      await img.decode();
    } else {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('无法解码该图片'));
        img.src = url;
      });
    }
    if (!img.naturalWidth) throw new Error('无法解码该图片');
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * 解码为原始分辨率可绘制对象（ImageBitmap 优先，失败时退回 <img>）。
 * @returns {Promise<ImageBitmap|HTMLImageElement>}
 */
async function decodeFull(source) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(source);
    } catch {
      /* 某些格式（如旧浏览器下的 ico）不支持，走 <img> 兜底 */
    }
  }
  return loadViaImageElement(source);
}

/**
 * 把可绘制对象缩到长边上限以内。
 * @returns {ImageBitmap|HTMLCanvasElement|HTMLImageElement}
 */
async function shrink(source, maxEdge) {
  const sw = source.width || source.naturalWidth;
  const sh = source.height || source.naturalHeight;
  const longEdge = Math.max(sw, sh);
  if (!maxEdge || longEdge <= maxEdge) return source;

  const scale = maxEdge / longEdge;
  if (typeof createImageBitmap === 'function' && !(source instanceof HTMLCanvasElement)) {
    try {
      return await createImageBitmap(source, {
        resizeWidth: Math.max(1, Math.round(sw * scale)),
        resizeHeight: Math.max(1, Math.round(sh * scale)),
        resizeQuality: 'high',
      });
    } catch {
      /* 不支持 resize 选项时退化为 canvas 缩放 */
    }
  }

  const canvas = createCanvas(sw * scale, sh * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('图片编码失败'))),
        type,
        quality,
      );
    } catch (error) {
      reject(error);
    }
  });
}

let seq = 0;

export class WatermarkItem {
  id;
  file;
  fileName;
  /** 原始像素尺寸：水印几何以此为基准，与旧版一致 */
  width;
  height;
  /** 卡片展示画布 */
  canvas;

  #bitmap;
  #ctx;
  #disposed = false;

  constructor({ file, bitmap, width, height }) {
    this.id = `item-${++seq}`;
    this.file = file;
    this.fileName = file.name || `image-${seq}`;
    this.width = width;
    this.height = height;
    this.#bitmap = bitmap;
    this.canvas = createCanvas(bitmap.width, bitmap.height);
    this.#ctx = this.canvas.getContext('2d', { alpha: false });
  }

  static async create(file) {
    const full = await decodeFull(file);
    const width = full.width || full.naturalWidth;
    const height = full.height || full.naturalHeight;
    if (!width || !height) throw new Error('无法识别该图片的尺寸');

    const bitmap = await shrink(full, CARD_MAX_EDGE);
    if (bitmap !== full) full.close?.();
    return new WatermarkItem({ file, bitmap, width, height });
  }

  get disposed() {
    return this.#disposed;
  }

  /** 底图在卡片画布上的缩放比（原始像素 → 设备像素）。 */
  get baseScale() {
    return this.canvas.width / this.width;
  }

  /**
   * 在卡片画布上绘制「底图 + 水印」。
   * 用 canvas 变换缩放回原始像素坐标系，保证与全分辨率导出完全同构。
   */
  paint(config) {
    if (this.#disposed) return;
    const ctx = this.#ctx;
    const scale = this.baseScale;
    if (!(scale > 0)) return;

    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.drawImage(this.#bitmap, 0, 0, this.width, this.height);
    paintWatermark(ctx, this.width, this.height, config);
  }

  async #render(config, maxEdge, type, quality) {
    const full = await decodeFull(this.file);
    let source = full;
    let scaled = null;
    try {
      if (maxEdge) {
        const sw = full.width || full.naturalWidth;
        const sh = full.height || full.naturalHeight;
        if (Math.max(sw, sh) > maxEdge) scaled = await shrink(full, maxEdge);
        if (scaled) source = scaled;
      }

      const sw = source.width || source.naturalWidth;
      const sh = source.height || source.naturalHeight;
      const canvas = createCanvas(sw, sh);
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.drawImage(source, 0, 0);

      const scale = canvas.width / this.width;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      paintWatermark(ctx, this.width, this.height, config);

      return await canvasToBlob(canvas, type, quality);
    } finally {
      full.close?.();
      if (scaled && scaled !== full) scaled.close?.();
    }
  }

  /** 全分辨率 PNG：输出分辨率与像素结果和旧版一致。 */
  exportBlob(config) {
    return this.#render(config, null, 'image/png');
  }

  /** 灯箱预览用轻量图。 */
  previewBlob(config) {
    return this.#render(config, PREVIEW_MAX_EDGE, 'image/jpeg', 0.92);
  }

  dispose() {
    this.#disposed = true;
    this.#bitmap?.close?.();
    this.#bitmap = null;
    this.#ctx = null;
    this.canvas.width = 1;
    this.canvas.height = 1;
  }
}
