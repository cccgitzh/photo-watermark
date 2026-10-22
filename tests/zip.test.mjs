/**
 * tests/zip.test.mjs — 原生 ZIP 打包器回环校验
 *
 * 写完 ZIP 后再自己解析一遍：定位中央目录 → 读本地头 → 解压（或直读）→
 * 用 CRC32 与长度比对，确保产物是结构正确的压缩包（可被系统解压工具打开）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createZip, crc32 } from '../js/zip.js';

const decoder = new TextDecoder();

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZip(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // 从尾部找 EOCD
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.ok(eocd >= 0, '应能定位到 EOCD');

  const count = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);

  const entries = [];
  let cursor = centralOffset;
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(cursor, true), 0x02014b50, '中央目录记录签名');
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(buffer.subarray(cursor + 46, cursor + 46 + nameLength));

    assert.equal(view.getUint32(localOffset, true), 0x04034b50, '本地文件头签名');
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const payload = buffer.subarray(dataStart, dataStart + compressedSize);

    const content = method === 8 ? await inflateRaw(payload) : payload;

    entries.push({ name, method, crc, size, content });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  assert.equal(cursor - centralOffset, centralSize, '中央目录长度应与 EOCD 记录一致');
  return entries;
}

const toBytes = (blob) => blob.arrayBuffer().then((buf) => new Uint8Array(buf));

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (i * 37 + 11) % 256;
  return bytes;
}

test('crc32 与已知值一致', () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(crc32(bytes), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('打包结果可被解析，且 CRC / 长度 / 内容一致', async () => {
  const text = new TextEncoder().encode('水印测试内容'.repeat(400));
  const binary = randomBytes(5000);
  const tiny = new TextEncoder().encode('hi');

  const entries = [
    { name: '照片 1.png', data: text },
    { name: 'photo (2).png', data: binary },
    { name: 'a.txt', data: tiny },
  ];

  const blob = await createZip(entries);
  assert.equal(blob.type, 'application/zip');
  const buffer = await toBytes(blob);
  const parsed = await readZip(buffer);

  assert.equal(parsed.length, 3);
  assert.deepEqual(parsed.map((e) => e.name), entries.map((e) => e.name));

  for (let i = 0; i < entries.length; i++) {
    const raw = entries[i].data;
    assert.equal(parsed[i].size, raw.length);
    assert.equal(parsed[i].crc, crc32(raw));
    assert.deepEqual(Array.from(parsed[i].content), Array.from(raw));
  }
});

test('中文文件名使用 UTF-8 标志位', async () => {
  const blob = await createZip([{ name: '水印图片.png', data: new Uint8Array([1, 2, 3]) }]);
  const buffer = await toBytes(blob);
  const view = new DataView(buffer.buffer);
  assert.equal(view.getUint16(6, true) & 0x0800, 0x0800, '通用标志位应置 UTF-8');
  const parsed = await readZip(buffer);
  assert.equal(parsed[0].name, '水印图片.png');
});

test('进度回调覆盖全部条目', async () => {
  const progress = [];
  await createZip(
    [
      { name: 'a', data: new Uint8Array(10) },
      { name: 'b', data: new Uint8Array(20) },
      { name: 'c', data: new Uint8Array(30) },
    ],
    { onProgress: (ratio) => progress.push(ratio) },
  );
  assert.equal(progress.length, 3);
  assert.equal(progress.at(-1), 1);
});

test('空列表与中途取消会抛出可识别错误', async () => {
  await assert.rejects(() => createZip([]), /没有需要打包的文件/);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => createZip([{ name: 'a', data: new Uint8Array(4) }], { signal: controller.signal }),
    (error) => error.name === 'AbortError',
  );
});
