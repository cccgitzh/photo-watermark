/**
 * gallery.js — 图片列表：卡片渲染、拖拽排序、懒绘制
 *
 * 性能要点：
 *   · 配置变化时只在下一个动画帧统一重绘（requestAnimationFrame 合并高频 input 事件）；
 *   · 用 IntersectionObserver 只重绘视口内的卡片，滚出视口的先标记为脏，回到视口再画；
 *   · 卡片底图是缩放后的位图，单次重绘只做一次小尺寸 drawImage + 文字绘制。
 */

import { paintWatermark } from './watermark.js';
import { formatBytes } from './items.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function icon(paths, size = 15) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

const ICONS = {
  copy: ['M9 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'],
  download: ['M12 4v10', 'm8 11 4 4 4-4', 'M5 19h14'],
  trash: ['M4 7h16', 'M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2', 'M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12'],
};

function roundRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, width, height, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

export class Gallery {
  #items = [];
  #nodes = new Map(); // id → { el, item }
  #dirty = new Set();
  #rafId = 0;
  #observer;
  #demoBase = null;
  #demoDirty = true;

  /**
   * @param {{container: HTMLElement, emptyEl: HTMLElement, demoCanvas: HTMLCanvasElement,
   *          store: import('./state.js').ConfigStore,
   *          onCountChange?: (info: {count: number, bytes: number}) => void,
   *          onPreview?: (index: number) => void,
   *          onAction?: (action: string, item: object) => void}} options
   */
  constructor(options) {
    this.container = options.container;
    this.emptyEl = options.emptyEl;
    this.demoCanvas = options.demoCanvas;
    this.store = options.store;
    this.onCountChange = options.onCountChange || (() => {});
    this.onPreview = options.onPreview || (() => {});
    this.onAction = options.onAction || (() => {});

    this.#observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.dataset.id;
          entry.target.dataset.visible = entry.isIntersecting ? '1' : '0';
          if (entry.isIntersecting && this.#dirty.has(id)) {
            this.#paint(id);
          }
        }
      },
      { rootMargin: '200px 0px' },
    );

    this.#bindDragSort();
    this.store.subscribe(() => {
      this.markAllDirty();
      this.#demoDirty = true;
      this.#schedule();
    });
    this.#sync();
  }

  get items() {
    return this.#items;
  }

  get count() {
    return this.#items.length;
  }

  indexOf(id) {
    return this.#items.findIndex((item) => item.id === id);
  }

  itemAt(index) {
    return this.#items[index];
  }

  /** 追加一个已解码的条目并立即挂载卡片。 */
  add(item) {
    this.#items.push(item);
    this.#mount(item);
    this.#sync();
    this.markDirty(item.id);
    this.#schedule();
    return item;
  }

  /** 移除但不销毁（供撤销使用）。 */
  remove(id) {
    const index = this.indexOf(id);
    if (index < 0) return null;
    const [item] = this.#items.splice(index, 1);
    const node = this.#nodes.get(id);
    if (node) {
      this.#observer.unobserve(node.el);
      node.el.remove();
      this.#nodes.delete(id);
    }
    this.#dirty.delete(id);
    this.#sync();
    return { item, index };
  }

  /** 清空并返回快照（供撤销）。 */
  clear() {
    const snapshot = this.#items.map((item) => ({ item, index: this.indexOf(item.id) }));
    for (const { item } of snapshot) {
      const node = this.#nodes.get(item.id);
      if (node) {
        this.#observer.unobserve(node.el);
        node.el.remove();
        this.#nodes.delete(item.id);
      }
    }
    this.#items = [];
    this.#dirty.clear();
    this.#sync();
    return snapshot;
  }

  /** 把条目按指定下标重新插入（撤销恢复用）。 */
  insert(item, index) {
    if (this.indexOf(item.id) >= 0) return;
    const at = Math.max(0, Math.min(index, this.#items.length));
    this.#items.splice(at, 0, item);
    this.#mount(item, at);
    this.#sync();
    this.markDirty(item.id);
    this.#schedule();
  }

  move(id, delta) {
    const from = this.indexOf(id);
    if (from < 0) return false;
    const to = from + delta;
    if (to < 0 || to >= this.#items.length) return false;
    const [item] = this.#items.splice(from, 1);
    this.#items.splice(to, 0, item);
    const node = this.#nodes.get(id);
    const reference = this.#items[to + 1];
    const refNode = reference ? this.#nodes.get(reference.id) : null;
    if (node) this.container.insertBefore(node.el, refNode ? refNode.el : null);
    this.#sync();
    return true;
  }

  markDirty(id) {
    this.#dirty.add(id);
  }

  markAllDirty() {
    for (const item of this.#items) this.#dirty.add(item.id);
  }

  #paint(id) {
    const node = this.#nodes.get(id);
    if (!node) return;
    // 视口外的卡片先保留脏标记，滚回来时由 IntersectionObserver 触发重绘
    if (node.el.dataset.visible === '0') return;
    node.item.paint(this.store.state);
    this.#dirty.delete(id);
  }

  #schedule() {
    if (this.#rafId) return;
    this.#rafId = requestAnimationFrame(() => {
      this.#rafId = 0;
      for (const id of [...this.#dirty]) this.#paint(id);
      if (this.#demoDirty && this.count === 0) this.#paintDemo();
    });
  }

  #mount(item, index) {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.id = item.id;
    card.dataset.visible = '1';
    card.draggable = true;
    card.tabIndex = 0;
    card.setAttribute('aria-label', `${item.fileName}，${item.width}×${item.height}`);

    const media = document.createElement('div');
    media.className = 'card-media';
    media.appendChild(item.canvas);

    const badge = document.createElement('span');
    badge.className = 'card-badge';
    badge.textContent = `${item.width}×${item.height}`;
    media.appendChild(badge);

    const zoom = document.createElement('button');
    zoom.type = 'button';
    zoom.className = 'card-zoom';
    zoom.setAttribute('aria-label', '预览大图');
    zoom.addEventListener('click', () => {
      const i = this.indexOf(item.id);
      if (i >= 0) this.onPreview(i);
    });
    media.appendChild(zoom);

    const foot = document.createElement('div');
    foot.className = 'card-foot';

    const name = document.createElement('span');
    name.className = 'card-name';
    name.textContent = item.fileName;
    name.title = `${item.fileName} · ${formatBytes(item.file.size)}`;

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const makeBtn = (act, label, paths, extraClass = '') => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `card-btn ${extraClass}`.trim();
      btn.dataset.act = act;
      btn.title = label;
      btn.setAttribute('aria-label', label);
      btn.appendChild(icon(paths));
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        this.onAction(act, item);
      });
      return btn;
    };

    actions.append(
      makeBtn('copy', '复制到剪贴板', ICONS.copy),
      makeBtn('download', '下载这张', ICONS.download),
      makeBtn('delete', '删除', ICONS.trash, 'danger'),
    );

    foot.append(name, actions);
    card.append(media, foot);

    card.addEventListener('keydown', (event) => {
      if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        this.move(item.id, event.key === 'ArrowLeft' ? -1 : 1);
        this.#nodes.get(item.id)?.el.focus();
      } else if (event.key === 'Enter') {
        const i = this.indexOf(item.id);
        if (i >= 0) {
          event.preventDefault();
          this.onPreview(i);
        }
      }
    });

    const reference = this.#items[index + 1];
    const refNode = reference ? this.#nodes.get(reference.id) : null;
    this.container.insertBefore(card, refNode ? refNode.el : null);
    this.#nodes.set(item.id, { el: card, item });
    this.#observer.observe(card);
  }

  #sync() {
    const empty = this.#items.length === 0;
    this.emptyEl.hidden = !empty;
    this.container.hidden = empty;
    const bytes = this.#items.reduce((sum, item) => sum + (item.file.size || 0), 0);
    this.onCountChange({ count: this.#items.length, bytes });
    if (empty) {
      this.#demoDirty = true;
      this.#schedule();
    }
  }

  #bindDragSort() {
    let dragId = null;

    const clearMarks = () => {
      for (const node of this.#nodes.values()) {
        node.el.classList.remove('is-drop-before', 'is-drop-after');
      }
    };

    this.container.addEventListener('dragstart', (event) => {
      const card = event.target.closest('.card');
      if (!card) return;
      dragId = card.dataset.id;
      card.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      // 必须写入数据，Firefox 才会进入拖拽流程
      event.dataTransfer.setData('text/plain', dragId);
    });

    this.container.addEventListener('dragend', () => {
      dragId = null;
      clearMarks();
      for (const node of this.#nodes.values()) node.el.classList.remove('is-dragging');
    });

    this.container.addEventListener('dragover', (event) => {
      if (!dragId) return;
      const card = event.target.closest('.card');
      if (!card || card.dataset.id === dragId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      clearMarks();
      const rect = card.getBoundingClientRect();
      const horizontal = rect.width > 0;
      const after = horizontal
        ? event.clientX > rect.left + rect.width / 2
        : event.clientY > rect.top + rect.height / 2;
      card.classList.add(after ? 'is-drop-after' : 'is-drop-before');
    });

    this.container.addEventListener('drop', (event) => {
      if (!dragId) return;
      const card = event.target.closest('.card');
      event.preventDefault();
      event.stopPropagation();
      clearMarks();
      if (!card || card.dataset.id === dragId) return;

      const rect = card.getBoundingClientRect();
      const after = event.clientX > rect.left + rect.width / 2;
      const targetIndex = this.indexOf(card.dataset.id);
      const from = this.indexOf(dragId);
      if (targetIndex < 0 || from < 0) return;

      const [item] = this.#items.splice(from, 1);
      let insertAt = targetIndex + (after ? 1 : 0);
      if (from < insertAt) insertAt--;
      this.#items.splice(insertAt, 0, item);

      const node = this.#nodes.get(dragId);
      const reference = this.#items[insertAt + 1];
      const refNode = reference ? this.#nodes.get(reference.id) : null;
      if (node) this.container.insertBefore(node.el, refNode ? refNode.el : null);
      this.#sync();
      dragId = null;
    });
  }

  /** 空状态下的示例底图（一次性生成）：模拟「深色台面上的证件照片」 */
  #buildDemoBase() {
    const { width, height } = this.demoCanvas;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, '#22304a');
    bg.addColorStop(0.5, '#2f4059');
    bg.addColorStop(1, '#3b4a63');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // 左上角柔光，让画面不像纯色块
    const glow = ctx.createRadialGradient(width * 0.18, height * 0.1, 0, width * 0.18, height * 0.1, width * 0.75);
    glow.addColorStop(0, 'rgba(255,255,255,0.16)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    // 桌面上的证件卡片（轻微旋转 + 阴影，模拟拍摄角度）
    const cardW = width * 0.56;
    const cardH = height * 0.62;
    const cx = width * 0.5;
    const cy = height * 0.52;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.035);
    ctx.shadowColor = 'rgba(6, 12, 24, 0.55)';
    ctx.shadowBlur = 42;
    ctx.shadowOffsetY = 20;

    const cardGrad = ctx.createLinearGradient(-cardW / 2, -cardH / 2, cardW / 2, cardH / 2);
    cardGrad.addColorStop(0, '#f7f9fc');
    cardGrad.addColorStop(1, '#e2e8f1');
    ctx.fillStyle = cardGrad;
    roundRectPath(ctx, -cardW / 2, -cardH / 2, cardW, cardH, 22);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.035);

    // 标题条
    ctx.fillStyle = 'rgba(30, 41, 59, 0.16)';
    roundRectPath(ctx, -cardW / 2 + 44, -cardH / 2 + 46, cardW * 0.34, 24, 12);
    ctx.fill();

    // 正文行
    ctx.fillStyle = 'rgba(30, 41, 59, 0.1)';
    for (let i = 0; i < 4; i++) {
      const w = cardW * (0.66 - i * 0.1);
      roundRectPath(ctx, -cardW / 2 + 44, -cardH / 2 + 104 + i * 34, w, 13, 7);
      ctx.fill();
    }

    // 头像/照片位
    const phW = cardW * 0.26;
    const phH = phW * 1.2;
    ctx.fillStyle = 'rgba(30, 41, 59, 0.12)';
    roundRectPath(ctx, cardW / 2 - phW - 44, cardH / 2 - phH - 44, phW, phH, 14);
    ctx.fill();

    // 底部签名线
    ctx.fillStyle = 'rgba(30, 41, 59, 0.08)';
    roundRectPath(ctx, -cardW / 2 + 44, cardH / 2 - 58, cardW * 0.3, 10, 5);
    ctx.fill();
    ctx.restore();

    this.#demoBase = canvas;
  }

  #paintDemo() {
    if (this.count > 0) return;
    if (!this.#demoBase) this.#buildDemoBase();
    const canvas = this.demoCanvas;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.#demoBase, 0, 0);
    paintWatermark(ctx, canvas.width, canvas.height, this.store.state);
    this.#demoDirty = false;
  }
}
