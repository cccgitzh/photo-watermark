/**
 * zip.js — 零依赖的 ZIP 打包器
 *
 * 旧版为此打包了 97 KB 的 JSZip（UMD，另有一条 CDN 兜底请求）。这里改为
 * 直接基于浏览器原生 CompressionStream('deflate-raw') 写 ZIP 结构：
 *   · 体积 0（无第三方代码），首屏更快；
 *   · 不再有任何外部请求，隐私承诺才真正成立；
 *   · 环境不支持 deflate-raw 时自动退化为 STORED（仅存储），产物仍是合法 ZIP。
 */

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
/** 已是压缩格式（PNG 等）时，deflate 常常收效甚微，低于该体积直接存储。 */
const MIN_DEFLATE_SIZE = 1024;
const MAX_ENTRIES = 0xfffe;
const MAX_TOTAL_SIZE = 0xffffffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const toDosDateTime = (date) => {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
};

const supportsDeflateRaw = () => {
  if (typeof CompressionStream === 'undefined') return false;
  try {
    new CompressionStream('deflate-raw');
    return true;
  } catch {
    return false;
  }
};

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

async function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  throw new TypeError('不支持的条目类型');
}

class ByteSink {
  #chunks = [];
  #length = 0;

  get length() {
    return this.#length;
  }

  push(bytes) {
    this.#chunks.push(bytes);
    this.#length += bytes.length;
    return bytes.length;
  }

  toBlob(type = 'application/zip') {
    return new Blob(this.#chunks, { type });
  }
}

/**
 * 生成 ZIP。
 * @param {Array<{name: string, data: Blob|ArrayBuffer|Uint8Array}>} entries
 * @param {{onProgress?: (ratio: number) => void, signal?: AbortSignal, compress?: boolean}} [options]
 * @returns {Promise<Blob>}
 */
export async function createZip(entries, options = {}) {
  const { onProgress, signal, compress = true } = options;

  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('没有需要打包的文件');
  }
  if (entries.length > MAX_ENTRIES) {
    throw new Error('文件数量超出 ZIP 经典格式上限（65534）');
  }

  const canDeflate = compress && supportsDeflateRaw();
  const sink = new ByteSink();
  const central = [];
  const encoder = new TextEncoder();
  const now = new Date();
  const { dosTime, dosDate } = toDosDateTime(now);

  for (let index = 0; index < entries.length; index++) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');

    const entry = entries[index];
    const raw = await toBytes(entry.data);
    if (raw.length > MAX_TOTAL_SIZE) throw new Error('单文件超过 4 GB，暂不支持');

    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(raw);

    let payload = raw;
    let method = METHOD_STORE;
    if (canDeflate && raw.length >= MIN_DEFLATE_SIZE) {
      try {
        const packed = await deflateRaw(raw);
        if (packed.length < raw.length) {
          payload = packed;
          method = METHOD_DEFLATE;
        }
      } catch {
        /* 压缩失败即存储，不影响产物有效性 */
      }
    }

    const offset = sink.length;

    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, LOCAL_HEADER_SIG, true);
    view.setUint16(4, 20, true); // version needed
    view.setUint16(6, FLAG_UTF8, true);
    view.setUint16(8, method, true);
    view.setUint16(10, dosTime, true);
    view.setUint16(12, dosDate, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, payload.length, true);
    view.setUint32(22, raw.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    header.set(nameBytes, 30);

    sink.push(header);
    sink.push(payload);

    central.push({ nameBytes, crc, method, compressedSize: payload.length, size: raw.length, offset });

    onProgress?.((index + 1) / entries.length);
    // 让出主线程，保证进度条与取消按钮可响应
    if (index % 3 === 2) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const centralStart = sink.length;
  for (const item of central) {
    const record = new Uint8Array(46 + item.nameBytes.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, CENTRAL_HEADER_SIG, true);
    view.setUint16(4, 0x031e, true); // made by: unix, version 3.0
    view.setUint16(6, 20, true);
    view.setUint16(8, FLAG_UTF8, true);
    view.setUint16(10, item.method, true);
    view.setUint16(12, dosTime, true);
    view.setUint16(14, dosDate, true);
    view.setUint32(16, item.crc, true);
    view.setUint32(20, item.compressedSize, true);
    view.setUint32(24, item.size, true);
    view.setUint16(28, item.nameBytes.length, true);
    view.setUint16(30, 0, true); // extra
    view.setUint16(32, 0, true); // comment
    view.setUint16(34, 0, true); // disk
    view.setUint16(36, 0, true); // internal attrs
    view.setUint32(38, 0o100644 << 16, true); // external attrs: -rw-r--r--
    view.setUint32(42, item.offset, true);
    record.set(item.nameBytes, 46);
    sink.push(record);
  }

  const centralSize = sink.length - centralStart;
  if (sink.length > MAX_TOTAL_SIZE) throw new Error('压缩包超过 4 GB，请分批导出');

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, EOCD_SIG, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, central.length, true);
  eocdView.setUint16(10, central.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, centralStart, true);
  eocdView.setUint16(20, 0, true);
  sink.push(eocd);

  return sink.toBlob();
}
