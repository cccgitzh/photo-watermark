/**
 * exporter.js — 单张下载、复制到剪贴板、批量打包导出
 */

import { createZip } from './zip.js';
import { safeFileName, timestamp } from './items.js';

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 立即 revoke 在部分浏览器会打断下载，交给下一轮事件循环
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function suggestedFileName(item) {
  return `${safeFileName(item.fileName)}.png`;
}

export async function downloadItem(item, config) {
  const blob = await item.exportBlob(config);
  downloadBlob(blob, suggestedFileName(item));
}

/** @returns {Promise<boolean>} 是否成功写入剪贴板 */
export async function copyItem(item, config) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false;
  const blob = await item.exportBlob(config);
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

function uniqueName(used, base) {
  const key = `${base}.png`;
  const count = used.get(key) || 0;
  used.set(key, count + 1);
  return count === 0 ? key : `${base} (${count + 1}).png`;
}

/**
 * 逐张生成全分辨率 PNG 并打包为 ZIP。
 * 串行处理，任意时刻只有一张原图在内存中，避免旧版并发分块导致的内存峰值。
 *
 * @param {Array<import('./items.js').WatermarkItem>} items
 * @param {object} config
 * @param {{onProgress?: (ratio: number) => void, signal?: AbortSignal}} [options]
 */
export async function downloadAll(items, config, options = {}) {
  const { onProgress, signal } = options;
  if (items.length === 0) throw new Error('没有可导出的图片');

  const used = new Map();
  const entries = [];
  const total = items.length;

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    const item = items[i];
    const blob = await item.exportBlob(config);
    entries.push({ name: uniqueName(used, safeFileName(item.fileName)), data: blob });
    onProgress?.(((i + 1) / total) * 0.78);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  if (signal?.aborted) throw new DOMException('已取消', 'AbortError');

  const zip = await createZip(entries, {
    signal,
    onProgress: (ratio) => onProgress?.(0.78 + ratio * 0.22),
  });

  downloadBlob(zip, `水印图片_${timestamp()}.zip`);
  return zip;
}
