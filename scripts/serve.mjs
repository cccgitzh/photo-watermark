#!/usr/bin/env node
/**
 * scripts/serve.mjs — 零依赖静态服务器
 *
 * 项目使用 ES Module，直接双击 index.html（file:// 协议）会被浏览器拦截，
 * 因此本地预览、容器化部署都需要一个静态服务器。这里只用 Node 内置模块，
 * 不需要 npm install 任何东西。
 *
 * 用法：
 *   node scripts/serve.mjs            # http://localhost:8080
 *   node scripts/serve.mjs 3000       # 指定端口
 *   PORT=3000 node scripts/serve.mjs  # 同上
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  // 与页面 meta 中的 CSP 一致；图片全部来自 blob/data，因此无需放开网络请求
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; " +
    "font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';

  const target = resolve(join(ROOT, normalize(pathname)));
  // 目录穿越防护：解析结果必须仍在项目根目录内
  if (target !== ROOT && !target.startsWith(ROOT + sep)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('403 Forbidden');
    return;
  }

  if (!existsSync(target) || !statSync(target).isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('404 Not Found');
    return;
  }

  const ext = extname(target).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const isHtml = ext === '.html';

  response.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': type,
    'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=0, must-revalidate',
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  createReadStream(target).pipe(response);
});

server.listen(PORT, HOST, () => {
  console.log(`图片水印工具已启动： http://${HOST}:${PORT}`);
  console.log('按 Ctrl+C 停止服务');
});
