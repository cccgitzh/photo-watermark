/**
 * preview.js — 灯箱预览
 *
 * 使用原生 <dialog>：自动获得焦点管理、Esc 关闭与顶层渲染，
 * 无需再手写遮罩与键盘拦截。预览图按需生成（长边 ≤ 2560 的 JPEG），
 * 关闭或切换时释放上一张的 Object URL。
 */

export class Preview {
  #index = -1;
  #url = '';
  #token = 0;
  #touchStartX = 0;

  constructor({ dialog, image, nameEl, counterEl, loadingEl, gallery, store, onNotice }) {
    this.dialog = dialog;
    this.image = image;
    this.nameEl = nameEl;
    this.counterEl = counterEl;
    this.loadingEl = loadingEl;
    this.gallery = gallery;
    this.store = store;
    this.onNotice = onNotice;

    document.getElementById('previewClose')?.addEventListener('click', () => this.close());
    document.getElementById('previewPrev')?.addEventListener('click', () => this.step(-1));
    document.getElementById('previewNext')?.addEventListener('click', () => this.step(1));

    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.close();
    });

    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.close();
    });

    this.dialog.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        this.step(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        this.step(1);
      }
    });

    this.dialog.addEventListener(
      'touchstart',
      (event) => {
        this.#touchStartX = event.touches[0]?.clientX ?? 0;
      },
      { passive: true },
    );

    this.dialog.addEventListener(
      'touchend',
      (event) => {
        const endX = event.changedTouches[0]?.clientX ?? 0;
        const diff = endX - this.#touchStartX;
        if (Math.abs(diff) > 56) this.step(diff > 0 ? -1 : 1);
      },
      { passive: true },
    );
  }

  get isOpen() {
    return this.dialog.open;
  }

  open(index) {
    const total = this.gallery.count;
    if (total === 0) return;
    this.#index = Math.max(0, Math.min(index, total - 1));
    if (!this.dialog.open) this.dialog.showModal();
    this.#render();
  }

  close() {
    if (!this.dialog.open) return;
    this.dialog.close();
    this.#token++;
    this.#releaseUrl();
    this.image.removeAttribute('src');
    this.image.classList.remove('is-ready');
    this.loadingEl.hidden = true;
  }

  step(delta) {
    const total = this.gallery.count;
    if (total <= 1) return;
    this.#index = (this.#index + delta + total) % total;
    this.#render();
  }

  #releaseUrl() {
    if (this.#url) {
      URL.revokeObjectURL(this.#url);
      this.#url = '';
    }
  }

  async #render() {
    const total = this.gallery.count;
    const item = this.gallery.itemAt(this.#index);
    if (!item) return;

    const prevBtn = document.getElementById('previewPrev');
    const nextBtn = document.getElementById('previewNext');
    if (prevBtn) prevBtn.hidden = total <= 1;
    if (nextBtn) nextBtn.hidden = total <= 1;

    this.nameEl.textContent = item.fileName;
    this.counterEl.textContent = `${this.#index + 1} / ${total}`;
    this.loadingEl.hidden = false;
    this.image.classList.remove('is-ready');

    const token = ++this.#token;
    try {
      const blob = await item.previewBlob(this.store.state);
      if (token !== this.#token) return;

      const url = URL.createObjectURL(blob);
      await new Promise((resolve, reject) => {
        this.image.onload = resolve;
        this.image.onerror = () => reject(new Error('预览渲染失败'));
        this.image.src = url;
      });
      if (token !== this.#token) {
        URL.revokeObjectURL(url);
        return;
      }

      this.#releaseUrl();
      this.#url = url;
      this.image.classList.add('is-ready');
    } catch (error) {
      if (token === this.#token) {
        console.error(error);
        this.onNotice?.('预览生成失败，请重试');
      }
    } finally {
      if (token === this.#token) this.loadingEl.hidden = true;
    }
  }
}
