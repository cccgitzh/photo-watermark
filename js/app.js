/**
 * app.js — 应用装配
 *
 * 职责边界：
 *   state.js   参数唯一来源      watermark.js  绘制引擎
 *   items.js   解码/导出         gallery.js    列表与懒绘制
 *   controls.js 表单绑定         preview.js    灯箱
 *   exporter.js 下载/打包        ui.js         提示与确认
 * 本文件只做“连线”，不含算法。
 */

import { ConfigStore } from './state.js';
import { bindControls } from './controls.js';
import { Gallery } from './gallery.js';
import { Preview } from './preview.js';
import { toast, confirmAction } from './ui.js';
import {
  WatermarkItem,
  formatBytes,
  isSupportedImage,
  SUPPORTED_LABEL,
} from './items.js';
import { copyItem, downloadAll, downloadItem } from './exporter.js';
import { initTheme, toggleTheme } from './theme.js';

const $ = (id) => document.getElementById(id);

const MAX_FILES = 60;

const store = new ConfigStore();
initTheme();

const gallery = new Gallery({
  container: $('gallery'),
  emptyEl: $('empty'),
  demoCanvas: $('demoCanvas'),
  store,
  onCountChange: ({ count, bytes }) => {
    const countText = $('countText');
    const sizeText = $('sizeText');
    countText.textContent = count === 0 ? '还没有图片' : `${count} 张图片`;
    sizeText.textContent = count === 0 ? '上传后可一次批量导出' : `原图合计 ${formatBytes(bytes)} · 导出为 PNG`;
    $('btnDownloadAll').disabled = count === 0;
    $('btnClearAll').disabled = count === 0;
  },
  onPreview: (index) => preview.open(index),
  onAction: (action, item) => handleItemAction(action, item),
});

const preview = new Preview({
  dialog: $('previewDialog'),
  image: $('previewImg'),
  nameEl: $('previewName'),
  counterEl: $('previewCounter'),
  loadingEl: $('previewLoading'),
  gallery,
  store,
  onNotice: (message) => toast(message, { type: 'error' }),
});

bindControls(store);

/* ------------------------------------------------------------------ *
 * 撤销栈
 * ------------------------------------------------------------------ */

/** @type {Array<{type: 'remove'|'clear', entries: Array<{item: object, index: number}>}>} */
const undoStack = [];
const UNDO_LIMIT = 20;

function disposeEntry(entry) {
  for (const { item } of entry.entries) item.dispose();
}

function pushUndo(entry) {
  undoStack.push(entry);
  while (undoStack.length > UNDO_LIMIT) {
    disposeEntry(undoStack.shift());
  }
}

function undo() {
  const entry = undoStack.pop();
  if (!entry) {
    toast('没有可撤销的操作');
    return;
  }
  for (const { item, index } of entry.entries) gallery.insert(item, index);
  toast(entry.type === 'clear' ? '已恢复全部图片' : '已恢复删除的图片', { type: 'success' });
}

/* ------------------------------------------------------------------ *
 * 图片入库队列
 * ------------------------------------------------------------------ */

const queueEl = $('queue');
const queueText = $('queueText');
const queueInner = $('queueInner');
const queueProgress = $('queueProgress');
const queueCancel = $('queueCancel');

/** @type {File[]} */
let pending = [];
let working = false;
let abortIntake = false;

function setQueueProgress(ratio, text) {
  const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  queueInner.style.width = `${percent}%`;
  queueProgress.setAttribute('aria-valuenow', String(percent));
  if (text) queueText.textContent = text;
}

async function ingest(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;

  const valid = files.filter(isSupportedImage);
  const rejected = files.length - valid.length;
  if (rejected > 0) {
    toast(`${rejected} 个文件不是受支持的图片格式（支持 ${SUPPORTED_LABEL}）`, { type: 'error' });
  }
  if (valid.length === 0) return;

  if (gallery.count + valid.length + pending.length > MAX_FILES) {
    const ok = await confirmAction({
      title: '图片数量较多',
      message: `一次处理超过 ${MAX_FILES} 张会让浏览器占用较多内存，建议分批处理。仍要继续吗？`,
      okText: '继续',
      danger: false,
    });
    if (!ok) return;
  }

  pending.push(...valid);
  void processQueue();
}

async function processQueue() {
  if (working) return;
  working = true;
  abortIntake = false;
  queueEl.hidden = false;

  const total = pending.length;
  let done = 0;
  let failed = 0;
  setQueueProgress(0, `正在读取 ${total} 张图片…`);

  while (pending.length > 0) {
    if (abortIntake) {
      pending.length = 0;
      break;
    }
    const file = pending.shift();
    try {
      const item = await WatermarkItem.create(file);
      gallery.add(item);
    } catch (error) {
      failed++;
      console.error('[watermark] 解码失败', file?.name, error);
    }
    done++;
    const remaining = done + pending.length;
    setQueueProgress(done / remaining, failed > 0
      ? `正在处理 ${done}/${remaining}（${failed} 张失败）`
      : `正在处理 ${done}/${remaining}`);
    // 让出主线程，保持界面可交互
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  working = false;
  setQueueProgress(1, '处理完成');
  setTimeout(() => {
    queueEl.hidden = true;
    setQueueProgress(0, '');
  }, 500);

  if (failed > 0) {
    toast(`${failed} 张图片解码失败，可能已损坏或格式不受支持`, { type: 'error' });
  } else if (!abortIntake) {
    toast(`已添加 ${done} 张图片`, { type: 'success', duration: 1600 });
  }
}

queueCancel.addEventListener('click', () => {
  abortIntake = true;
  toast('已停止读取');
});

/* ------------------------------------------------------------------ *
 * 文件来源：选择 / 拖拽 / 粘贴
 * ------------------------------------------------------------------ */

const fileInput = $('fileInput');
const dropzone = $('dropzone');

fileInput.addEventListener('change', () => {
  ingest(fileInput.files);
  fileInput.value = '';
});

// 空状态里的主按钮，直接唤起文件选择（移动端首屏就能找到入口）
$('emptyUpload').addEventListener('click', () => fileInput.click());

for (const type of ['dragenter', 'dragover']) {
  window.addEventListener(type, (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
    dropzone.classList.add('is-over');
  });
}

for (const type of ['dragleave', 'dragend']) {
  window.addEventListener(type, (event) => {
    if (event.target !== document.documentElement && event.target !== document.body) return;
    dropzone.classList.remove('is-over');
  });
}

window.addEventListener('drop', (event) => {
  dropzone.classList.remove('is-over');
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return; // 站内拖拽排序，交给 gallery
  event.preventDefault();
  ingest(files);
});

// 拖到非拖拽区时阻止浏览器直接打开图片
window.addEventListener('dragover', (event) => {
  if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
});

document.addEventListener('paste', (event) => {
  const target = event.target;
  const isTextField =
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

  const files = Array.from(event.clipboardData?.files || []).filter(isSupportedImage);
  if (files.length === 0) {
    if (!isTextField) {
      const text = event.clipboardData?.getData('text/plain');
      if (text) toast('剪贴板里没有图片');
    }
    return; // 文本框内的纯文字粘贴交回浏览器默认行为
  }
  event.preventDefault();
  ingest(files);
});

/* ------------------------------------------------------------------ *
 * 卡片操作 / 批量导出
 * ------------------------------------------------------------------ */

async function handleItemAction(action, item) {
  if (action === 'delete') {
    const removed = gallery.remove(item.id);
    if (!removed) return;
    pushUndo({ type: 'remove', entries: [removed] });
    toast('已删除，可撤销', {
      type: 'info',
      duration: 5000,
      actionLabel: '撤销',
      onAction: undo,
    });
    return;
  }

  if (action === 'download') {
    try {
      await downloadItem(item, store.state);
      toast('已开始下载', { type: 'success', duration: 1600 });
    } catch (error) {
      console.error(error);
      toast('导出失败，请重试', { type: 'error' });
    }
    return;
  }

  if (action === 'copy') {
    try {
      const ok = await copyItem(item, store.state);
      toast(ok ? '已复制到剪贴板' : '当前浏览器不支持复制图片，请改用下载', {
        type: ok ? 'success' : 'error',
      });
    } catch (error) {
      console.error(error);
      toast('复制失败，请重试', { type: 'error' });
    }
  }
}

const batchEl = $('batch');
const batchText = $('batchText');
const batchInner = $('batchInner');
const batchProgress = $('batchProgress');
const batchCancel = $('batchCancel');
const btnDownloadAll = $('btnDownloadAll');
const btnClearAll = $('btnClearAll');

let exporting = false;
let exportController = null;

function setBatchProgress(ratio, text) {
  const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  batchInner.style.width = `${percent}%`;
  batchProgress.setAttribute('aria-valuenow', String(percent));
  if (text) batchText.textContent = text;
}

async function exportAll() {
  if (exporting || gallery.count === 0) return;
  exporting = true;
  exportController = new AbortController();
  btnDownloadAll.classList.add('is-busy');
  btnDownloadAll.disabled = true;
  batchEl.hidden = false;
  setBatchProgress(0, '正在导出…');

  try {
    await downloadAll(gallery.items.slice(), store.state, {
      signal: exportController.signal,
      onProgress: (ratio) => {
        const label = ratio < 0.78 ? '正在生成图片…' : '正在打包 ZIP…';
        setBatchProgress(ratio, `${label} ${Math.round(ratio * 100)}%`);
      },
    });
    setBatchProgress(1, '导出完成');
    toast('压缩包已生成', { type: 'success' });
  } catch (error) {
    if (error?.name === 'AbortError') {
      toast('已取消导出');
    } else {
      console.error(error);
      toast(error?.message || '导出失败，请重试', { type: 'error' });
    }
  } finally {
    exporting = false;
    exportController = null;
    btnDownloadAll.classList.remove('is-busy');
    btnDownloadAll.disabled = gallery.count === 0;
    setTimeout(() => {
      batchEl.hidden = true;
      setBatchProgress(0, '');
    }, 700);
  }
}

btnDownloadAll.addEventListener('click', exportAll);
batchCancel.addEventListener('click', () => exportController?.abort());

btnClearAll.addEventListener('click', async () => {
  if (gallery.count === 0) return;
  const ok = await confirmAction({
    title: '清空所有图片',
    message: `将移除 ${gallery.count} 张图片（可用 Ctrl/⌘ + Z 撤销）。`,
    okText: '清空',
  });
  if (!ok) return;
  const snapshot = gallery.clear();
  pushUndo({ type: 'clear', entries: snapshot });
  toast('已清空，可撤销', {
    duration: 5000,
    actionLabel: '撤销',
    onAction: undo,
  });
});

/* ------------------------------------------------------------------ *
 * 顶栏交互与快捷键
 * ------------------------------------------------------------------ */

$('themeToggle').addEventListener('click', () => {
  const theme = toggleTheme();
  $('themeToggle').setAttribute('aria-label', theme === 'dark' ? '切换浅色模式' : '切换深色模式');
});

const helpToggle = $('helpToggle');
const helpPop = $('helpPop');

function setHelp(open) {
  helpPop.hidden = !open;
  helpToggle.setAttribute('aria-expanded', String(open));
}

helpToggle.addEventListener('click', (event) => {
  event.stopPropagation();
  setHelp(helpPop.hidden);
});

document.addEventListener('click', (event) => {
  if (helpPop.hidden) return;
  if (event.target.closest('#helpPop') || event.target.closest('#helpToggle')) return;
  setHelp(false);
});

document.addEventListener('keydown', (event) => {
  if (preview.isOpen) return;
  const target = event.target;
  const isField =
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');

  const modifier = event.ctrlKey || event.metaKey;

  if (modifier && event.key.toLowerCase() === 'd') {
    event.preventDefault();
    void exportAll();
    return;
  }

  if (modifier && event.key.toLowerCase() === 'z' && !isField) {
    event.preventDefault();
    undo();
    return;
  }

  if (isField) return;

  if (!modifier && !event.altKey && /^[1-9]$/.test(event.key)) {
    event.preventDefault();
    store.patch({ size: Number(event.key) / 3 });
  }
});
