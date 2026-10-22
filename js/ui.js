/**
 * ui.js — 轻提示与确认框（替代旧版大量的 alert / confirm）
 */

const MAX_TOASTS = 3;

function getRegion() {
  let region = document.getElementById('toastRegion');
  if (!region) {
    region = document.createElement('div');
    region.className = 'toast-region';
    region.id = 'toastRegion';
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }
  return region;
}

/**
 * @param {string} message
 * @param {{type?: 'info'|'success'|'error', duration?: number, actionLabel?: string, onAction?: () => void}} [options]
 */
export function toast(message, options = {}) {
  const { type = 'info', duration = 2600, actionLabel, onAction } = options;
  const region = getRegion();

  while (region.children.length >= MAX_TOASTS) {
    region.firstElementChild?.remove();
  }

  const el = document.createElement('div');
  el.className = `toast is-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const dot = document.createElement('span');
  dot.className = 'toast-dot';

  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;

  el.append(dot, text);

  let timer = 0;
  const dismiss = () => {
    clearTimeout(timer);
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400);
  };

  if (actionLabel && typeof onAction === 'function') {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'toast-action';
    action.textContent = actionLabel;
    action.addEventListener('click', () => {
      dismiss();
      onAction();
    });
    el.append(action);
  }

  region.appendChild(el);
  timer = setTimeout(dismiss, Math.max(1200, duration));
  return dismiss;
}

let activeConfirm = null;

/**
 * Promise 化确认框，语义等价于 confirm()，但样式统一、可键盘操作。
 * @param {{title?: string, message: string, okText?: string, cancelText?: string, danger?: boolean}} options
 * @returns {Promise<boolean>}
 */
export function confirmAction(options) {
  const dialog = document.getElementById('confirmDialog');
  const titleEl = document.getElementById('confirmTitle');
  const textEl = document.getElementById('confirmText');
  const okBtn = document.getElementById('confirmOk');
  const cancelBtn = document.getElementById('confirmCancel');

  if (!dialog || typeof dialog.showModal !== 'function') {
    return Promise.resolve(window.confirm(options.message));
  }

  activeConfirm?.resolve(false);

  titleEl.textContent = options.title || '确认操作';
  textEl.textContent = options.message;
  okBtn.textContent = options.okText || '确定';
  cancelBtn.textContent = options.cancelText || '取消';
  okBtn.classList.toggle('btn-danger', options.danger !== false);
  okBtn.classList.toggle('btn-primary', options.danger === false);

  return new Promise((resolve) => {
    const finish = (value) => {
      cleanup();
      if (dialog.open) dialog.close();
      resolve(value);
    };

    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onDialogCancel = (event) => {
      event.preventDefault();
      finish(false);
    };
    const onBackdrop = (event) => {
      if (event.target === dialog) finish(false);
    };

    function cleanup() {
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onDialogCancel);
      dialog.removeEventListener('click', onBackdrop);
      if (activeConfirm?.resolve === finish) activeConfirm = null;
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onDialogCancel);
    dialog.addEventListener('click', onBackdrop);

    activeConfirm = { resolve: finish };
    dialog.showModal();
    cancelBtn.focus();
  });
}
