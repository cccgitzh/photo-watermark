# 02 · 升级方案说明

## 一、目标与约束

**四个硬约束**

1. **效果不变**：同一张图、同一组参数，导出的 PNG 必须与原版逐像素一致（渲染路径等价，而非"看起来差不多"）。
2. **零运行时依赖**：不引入框架、不引入 npm 运行时包，产物仍是可直接托管的静态文件，不需要构建步骤。
3. **绝对不联网**：页面不加载任何第三方资源，CSP 层直接禁止 `connect-src`。
4. **可直接部署**：`git push` 即可上线（GitHub Pages），另有 Docker / Nginx / 任意静态服务器三条路径。

**设计取舍**

| 取舍点 | 选择 | 理由 |
| --- | --- | --- |
| 是否用框架（Vue/React） | 不用 | 页面只有一个视图，框架带来的运行时（30–130 KB）与构建链，换不来收益 |
| 是否用打包器 | 不用（原生 ESM） | 保持"改完即生效"，避免为了 17 个小文件引入 node_modules |
| 是否保留 JSZip | 移除 | 97.6 KB 只为打包；原生 `CompressionStream` 209 行即可替代 |
| 是否有构建步骤 | 无 | 部署 = 复制静态文件；测试用 Node 内置 runner |

---

## 二、目标架构

```
                    ┌──────────────── state.js ────────────────┐
                    │ 默认值 / 取值范围 / 归一化 / localStorage │
                    └───────────────┬──────────────────────────┘
         controls.js ──写──▶  store  ──订阅──▶ gallery.js ──▶ items.js ──▶ watermark.js
              ▲                                  │                          ▲
              └────────── 回写控件状态 ───────────┘                          │
                                                                     text-layout.js
   app.js（装配）：文件来源 → items 解码 → gallery 挂载 → 导出/预览/撤销/快捷键
                                  │
                     exporter.js ─┴─ zip.js（原生 deflate-raw + CRC32）
```

**模块职责表**

| 模块 | 职责 | 对外接口 |
| --- | --- | --- |
| `state.js` | 参数唯一来源；默认值、范围、归一化、持久化 | `ConfigStore`、`sanitizeConfig`、`DEFAULT_CONFIG` |
| `text-layout.js` | 换行算法（纯函数） | `wrapText(text, maxWidth, measure)` |
| `watermark.js` | 绘制引擎（纯函数，只依赖 2D context） | `paintWatermark(ctx, w, h, config)` |
| `items.js` | 解码、卡片画布、全分辨率导出、文件名处理 | `WatermarkItem`、`safeFileName`、`isSupportedImage` |
| `gallery.js` | 卡片列表、拖拽排序、懒绘制、示例画布 | `Gallery` |
| `preview.js` | `<dialog>` 灯箱、按需生成预览图 | `Preview` |
| `exporter.js` | 单张下载、剪贴板、批量打包 | `downloadItem`、`copyItem`、`downloadAll` |
| `zip.js` | 零依赖 ZIP 写入（deflate-raw / store） | `createZip`、`crc32` |
| `ui.js` | Toast、Promise 化确认框 | `toast`、`confirmAction` |
| `controls.js` | 表单 ↔ store 双向绑定、方向键单选 | `bindControls` |
| `theme.js` / `theme-init.js` | 主题切换；首屏同步应用（防闪白） | `initTheme`、`toggleTheme` |
| `app.js` | 唯一装配点：文件来源、队列、撤销、快捷键 | — |

**单向数据流**：控件 → `store.patch()` → 订阅者（gallery 标脏重绘 / controls 回写） → DOM。算法层完全不认识 DOM。

---

## 三、问题 → 处置对照

### A. 过时依赖与 API 误用

| 编号 | 处置 |
| --- | --- |
| A1 | **移除 JSZip**。新增 `js/zip.js`（209 行）：手写 ZIP 结构 + CRC32，压缩走原生 `CompressionStream('deflate-raw')`；已是压缩格式（PNG）且收益小时自动用 STORED。用 Python `zipfile` 交叉验证：`testzip()` 无错、中文名 UTF-8 正常、解压内容与源字节一致 |
| A2 | 删除 `navigator.deviceMemory` 分块逻辑，改为**串行导出**（任意时刻只有一张原图在内存），不需要猜内存 |
| A3 | 取消改为真正的 `AbortSignal`：`downloadAll` / `createZip` 在每个条目边界检查 `signal.aborted` 并抛 `AbortError`，UI 收到后回到干净状态 |
| A4 | 全部 `alert/confirm` 替换为 `ui.js`：底部 Toast（含"撤销"动作）+ `<dialog>` 确认框（Promise 化、Esc/遮罩可关、焦点自动落位） |
| A5 | 所有 HTML 结构静态写在 `index.html`；动态节点一律 `createElement` + `textContent`/`createElementNS`，零 `innerHTML`，因此可以启用严格 CSP |
| A6 | 拖拽排序真正实现：卡片 `draggable="true"`，`dragstart/dragover/drop` 计算插入位并给出前后指示线；另支持 `Alt + ←/→` 键盘排序 |
| A7 | 删除无效的 `pattern` 属性；颜色用 `input[type=color]` + 5 个预设色板（`aria-pressed` 标记选中） |
| A8 | 重写为完整文档结构：`<!DOCTYPE html>` + `<html lang="zh-CN">` + `<head>/<body>` + `<header>/<main>/<aside>/<footer>`；所有内联 `style` 与 `onclick` 清零 |
| A9 | 新增 `js/theme-init.js`，在 `<head>` 中**同步**执行（外部文件而非内联，以兼容 CSP），首屏前即写好 `data-theme`，无闪白 |
| A10 | 全部 `const/let` + ES Module 作用域；无隐式全局 |

### B. 性能

| 编号 | 处置 |
| --- | --- |
| B1 | 重绘改为"标脏 + `requestAnimationFrame` 合并 + 仅视口内绘制"：`IntersectionObserver` 标记可见性，滚出视口的卡片只保留脏标记，回到视口才画。一次输入事件最多每张可见卡片重绘一帧 |
| B2 | 卡片不再持有原尺寸 canvas：解码后按长边 1200 生成底图（`createImageBitmap` 的 `resizeWidth/Height` 硬件缩放），画布固定小尺寸；导出时才按需解码全尺寸并立即释放。单张常驻内存从 ~48 MB 降到 ~8.6 MB |
| B3 | 清屏用 `clearRect` + `setTransform` 复位，不再重设 `canvas.width`；同时把坐标系缩放到原始像素尺寸，保证卡片预览与全分辨率导出**同构**（见下文） |
| B4 | 预览改为一次 `toBlob(JPEG 0.92)`（长边 ≤ 2560），直接给 `<img>`；上一张的 Object URL 在新图加载完成后才回收 |
| B5 | 单张下载直接 `canvas.toBlob('image/png')`，去掉 base64 中转 |
| B6 | 串行导出 + 每个条目 `await` 一次宏任务让出主线程；ZIP 边生成边写入，峰值只多一份压缩产物 |
| B7 | 每行宽度只测量一次（`lines.map(measure)`），平铺循环内零 `measureText`；`wrapText` 内部再加一层字符串测量缓存。默认 12MP 场景测量次数 133 → 5 |
| B8 | 删掉 `toDataURL` 比对，预览直接按索引取 `gallery.itemAt(i)` |
| B9 | 初始化收敛到 `app.js` 一处装配；控件绑定集中在 `bindControls`，无重复监听 |

### C. 安全与隐私

| 编号 | 处置 |
| --- | --- |
| C1 | **删除 CDN 兜底**，打包完全本地实现；新增严格 CSP（`default-src 'none'`、`script-src 'self'`、`connect-src 'none'`），从策略层禁止任何网络请求。Docker/Nginx 与 `serve.mjs` 同时下发同名响应头 |
| C2 | 三重加固：① 严格 CSP（meta + 响应头）；② 零 `innerHTML`/内联事件；③ 新增 `X-Content-Type-Options`、`Referrer-Policy: no-referrer`、`Permissions-Policy`、`COOP/CORP`、`server_tokens off` |
| C3 | `safeFileName()`：剥离扩展名、替换 `/\?%*:|"<>`、删除控制字符、去首部点、拦截 Windows 保留名（`CON/PRN/AUX/NUL/COM1-9/LPT1-9`）、截断 80 字符；ZIP 内同名自动追加 ` (2)`、` (3)` |
| C4 | 输入约束：单次超过 60 张二次确认；`isSupportedImage` 同时校验 MIME 与扩展名；解码失败逐张捕获，不中断批次；平铺数超过 20000 直接跳过并告警 |
| C5 | 粘贴逻辑重写：在 `input/textarea/contenteditable` 内**不拦截**（交回浏览器原生粘贴，修掉原版的 `ReferenceError`）；仅在页面其他区域拦截图片粘贴 |
| C6 | 补齐基线安全响应头（同上），外链全部移除，页面不再有任何第三方 URL |

### D. 正确性

| 编号 | 处置 |
| --- | --- |
| D1 | 输入框粘贴交回浏览器原生行为；`input` 事件驱动状态更新，`maxlength=100` 且有字数计数 |
| D2 | 预览的键盘处理只保留在 `<dialog>` 上（`ArrowLeft/ArrowRight/Escape`），一次按键切一张；另加触屏左右滑动 |
| D3 | ZIP 内文件名去重（`名字.png`、`名字 (2).png`…），不再覆盖 |
| D4 | 删除全部死代码（`WatermarkUI`/`FileHandler`/`deleteBtn` 等 300 余行），控制台零报错 |
| D5 | 真正的撤销栈（最多 20 步）：删除单张、清空、批量都能 `Ctrl/⌘+Z` 恢复，Toast 内也提供"撤销"按钮 |
| D6 | 文件名规范化：`IMG_0001.png`；批量 ZIP 名为 `水印图片_20261022-101530.zip` |

### E. 可维护性

| 编号 | 处置 |
| --- | --- |
| E1 | 1722 行单文件 → 13 个模块（最大 `gallery.js` 441 行），按"算法 / 数据 / 视图 / 导出 / 基础设施"分层 |
| E2 | 参数收敛为 `ConfigStore`：默认值、范围、归一化、持久化、订阅一处定义；算法只接收普通对象 |
| E3 | CSS 重写为 `base / layout / components` 三个文件（设计令牌 + 布局 + 组件），删掉全部重复与未闭合块 |
| E4 | 新增 `tests/`：16 个用例，`node --test` 零依赖运行；CI 在部署前先跑测试 |
| E5 | 文档与实现对齐：README、四份 docs、许可证说明（README 不再声称 MIT，按 `LICENSE` 的 GPL-3.0 发布） |

### F. 体验与可访问性

| 编号 | 处置 |
| --- | --- |
| F1 | 空状态改为"示例画布"：生成一张模拟证件版式的底图并叠上当前水印，改参数即时反馈（WYSIWYG） |
| F2 | 四个滑块全部带数值回显（`0.30` / `0.80` / `1.5` / `45°`），并用 `<output for>` 关联 |
| F3 | 改为"左侧固定设置栏 + 右侧工作区"的双栏布局；桌面设置栏 `sticky` 独立滚动，移动端自动单列并把工作区提到最前 |
| F4 | 无障碍：语义化结构、`role="radiogroup"` + 方向键切换、`:focus-visible` 焦点环、`aria-live` 播报、`<dialog>` 自带焦点管理、色板/位置有 `aria-label`、卡片可 Tab 聚焦并用 `Enter` 预览 |
| F5 | Toast + 确认框替代 alert；删除/清空均可撤销；危险操作二次确认 |
| F6 | **移除全部作者信息、GitHub 链接、页脚版权**；页脚只保留"本地处理 + 导出说明" |
| F7 | 主题默认跟随系统（`prefers-color-scheme`），可手动切换并记忆；切换按钮置于顶栏工具区，不再浮动遮挡内容 |
| F8 | 顶栏"?"按钮展开快捷键与隐私说明面板（原生 `hidden` 切换，无注入 HTML） |

---

## 四、关键实现说明

### 1. 如何保证"水印效果完全不变"

这是整个升级里唯一不能靠肉眼验收的部分，因此用**几何等价性**来证明：

- 旧版绘制 = 一组 `translate / rotate / fillText` 调用。新版把同样的公式搬进 `watermark.js`，参数来源相同、运算顺序相同、字体字符串格式相同（`normal normal 48px "黑体"`）。
- 测试里实现了一个"记录型 2D context"（`tests/harness.mjs`）：把每次 `fillText` 的坐标乘以当前变换矩阵，记录成**绝对坐标**；`measureText` 用一套按字符类型估算的推进宽度模拟真实字体。
- `tests/legacy.mjs` 是旧算法的逐行移植；`tests/watermark.test.mjs` 让它与新版在同样的输入下各跑一遍，**逐字段比对绝对坐标、字体串、填充色**。

覆盖矩阵：6 种画布尺寸（含 3000×120 与 300×3000 这类极端比例）× 7 段文字 × 4 档字号 × 4 档间距 × 4 档角度 + 5 个位置 + 8 种数量（1–40）+ 4 种字体 × 粗体/斜体组合 + 4 色 × 5 档透明度。

结果：全部一致（16/16 通过）。这是"效果不变"的可执行证据，也是后续改动的回归基线。

### 2. 卡片预览与全分辨率导出为什么同构

旧版每张图一张原尺寸 canvas，所见即所得但内存爆炸；新版要在小画布上预览，最大的陷阱是**水印几何依赖画布尺寸**（字号 ∝ 对角线、单行宽度上限 500 px），直接缩小画布会导致换行不同、字号比例不同。

解法不是"按比例重新算一遍"，而是**把坐标系缩放回原始像素**：

```js
const scale = canvas.width / this.width;      // 卡片画布宽 / 原图宽
ctx.setTransform(scale, 0, 0, scale, 0, 0);   // 之后所有绘制都按原图像素坐标进行
ctx.drawImage(bitmap, 0, 0, this.width, this.height);
paintWatermark(ctx, this.width, this.height, config);  // 传原图尺寸
```

因为 `measureText` 不受变换矩阵影响，字号、行宽、间距、网格步长全部按原图计算，只是最终落在缩小后的画布上——与全分辨率导出**几何完全一致**，缩放比例由变换矩阵唯一决定。导出时 `scale === 1`，走的是同一条代码路径。

附带收益：`maxTextWidth` 的 `500 px` 上限、字号 `12 px` 下限这些"非线性"约束不再有缩放失真的风险。

### 3. 零依赖 ZIP

```
本地文件头 (30B + name)
  [deflate-raw 压缩数据 | 原始数据]
  ...
中央目录 (46B + name) × N
EOCD (22B)
```

- CRC32 用查表法（256 项表，一次构建）
- 压缩：`CompressionStream('deflate-raw')`；若压缩后反而更大（PNG 常见）则用 STORED
- 文件名 UTF-8 并置 **通用标志位 bit 11**，中文名不乱码
- 版本 20 / Unix 属性 `0644`，兼容 Windows 资源管理器、macOS 归档工具、`unzip`、Python `zipfile`
- 超出 4 GB 或 65534 条目时给出明确错误（不静默产出坏包）

验证方式（开发期实测）：Node 生成 → Python `zipfile` 读取 → `testzip()` 返回 `None`（无 CRC 错误），中文文件名、压缩/存储两种条目、原始字节全部一致。

### 4. 重绘调度

```
input 事件 (30~60/s) ──▶ store.patch() ──▶ gallery.markAllDirty() ──▶ rAF（合并）
                                                                        │
                                          ┌─────────────────────────────┘
                                          ▼
                            只画 dataset.visible === '1' 的卡片
                            视口外的保留脏标记，交给 IntersectionObserver
```

导出前调用 `flushPaint()` 强制补画，避免导出用到过期画面（实际导出是重新解码重绘，不依赖画布）。

### 5. 内存策略

| 阶段 | 旧 | 新 |
| --- | --- | --- |
| 导入 | FileReader → base64 dataURL（+33%）→ `<img>` → 原尺寸 canvas | `createImageBitmap(file)` → 缩放到长边 1200 → 关闭原图位图 |
| 常驻 | 每张 48 MB canvas | 每张 ~8.6 MB（1200×900 画布 + 底图） |
| 导出 | 保持全尺寸 canvas 常驻 | 临时解码全尺寸 → 绘制 → `toBlob` → `close()` 释放 |
| 打包 | 并发 3–10 张，峰值叠加 | 串行，一次一张 |

---

## 五、量化对比

测量环境：本机 Windows，Chrome 无头模式（`--disable-gpu`，软件渲染），同一脚本内对比两种重绘方式；取 15 次中位数。

| 指标 | 旧版 | 新版 | 变化 |
| --- | --- | --- | --- |
| 单张重绘（12 MP 整幅 vs 1200×900 缩放） | 20.9 ms | 7.5 ms | **−64%** |
| 20 张图一次参数变更（拖一下滑块的一帧） | ≈418 ms（全量串行） | ≈23 ms（仅视口内约 3 张 + rAF 合并） | **≈ −94%** |
| 每张图常驻位图 | ~48 MB | ~8.6 MB | **≈ −82%** |
| `measureText` 次数（默认参数 12 MP） | 133 | 5 | **−96%** |
| 运行时文件总量 | ≈197 KB | ≈119 KB | **−38%** |
| JS 体积 | 158.4 KB（其中 JSZip 97.6 KB，已压缩） | 74 KB（未压缩、可读源码） | **−53%** |
| 首屏网络请求数 | 5 | 17（ESM 未打包，各 2–14 KB） | +12 |
| 控制台报错 | 每次加载必现 TypeError | 0 | — |

> 说明：无头软件渲染的绝对毫秒数会高于真实 GPU 环境，但两种方案的**相对比例**可靠；请求数增加是"不打包"的直接代价，总字节仍下降 38%，在 HTTP/2 下无实质影响（若部署环境仅支持 HTTP/1.1，可选用 esbuild 一行命令合并，非必需）。

---

## 六、兼容性与降级

| 能力 | 基线 | 不支持时 |
| --- | --- | --- |
| ES Module / 私有字段 | Chrome 74+ / Safari 14.1+ | 无降级（现代浏览器即可） |
| `createImageBitmap(file)` | Chrome 50+ / Safari 15+ | 退回 `<img>` + `canvas` 缩放 |
| `createImageBitmap(bitmap, {resize*})` | Chrome 52+ / Safari 15+ | 退回 `drawImage` 缩放 |
| `CompressionStream('deflate-raw')` | Chrome 103+ / Safari 16.4+ / FF 113+ | ZIP 条目改用 STORED（仍合法，仅体积略大） |
| `<dialog>` | Chrome 37+ / Safari 15.4+ | `confirmAction` 退回 `window.confirm` |
| `navigator.clipboard.write` + `ClipboardItem` | Chromium / Safari 13.1+ | 提示"请改用下载" |
| `ctx.roundRect` | Chrome 99+ / Safari 16+ | `arcTo` 手绘圆角路径 |

目标基线：**Chrome / Edge 103+、Safari 16.4+、Firefox 113+**。

---

## 七、有意的行为差异（需知悉）

这些是"修复/改进"带来的可见变化，均不改变水印本身的渲染效果：

1. **单张下载文件名**：`IMG_0001.jpg_2026-10-22 0016.png` → `IMG_0001.png`（去时间戳与空格；批量内同名自动加 ` (2)`）
2. **批量包名**：`水印图片_<epoch>.zip` → `水印图片_20261022-101530.zip`
3. **删除快捷键**：不再把 `Delete` 绑定为"清空全部"（误触风险），改由工具栏"清空"按钮 + 二次确认；`Ctrl/⌘+Z` 从"只恢复最后一张"升级为多级撤销
4. **粘贴**：输入框内恢复正常粘贴（原版会抛错并吞掉内容）；页面空白处粘贴图片
5. **预览翻页**：一次按键切一张（原版一次切两张）
6. **参数记忆**：水印参数会写入 `localStorage`，下次打开沿用；主题默认跟随系统
7. **数量上限**：单次超过 60 张会提示确认；水印文字上限 100 字
8. **卡片布局**：统一 4:3 展示框（原为各自高度），缩略图居中留白，网格更整齐
9. **示例画布**：未上传图片时展示一张模拟证件版式并实时叠水印
10. **页面内容**：移除作者信息、GitHub 链接、页脚版权；页脚改为隐私与导出说明
11. **部署方式**：不再用 `python:3.9-alpine + http.server`，改 `nginx:1.27-alpine`（可下发安全响应头、开启 gzip）

---

## 八、遗留边界与后续建议

- **EXIF 方向**：依赖 `createImageBitmap` 的默认行为（`imageOrientation: 'from-image'`），与 `<img>` 渲染一致；极少数老旧解码器可能不自动旋转。
- **超大图（>100 MP）**：仍会以全分辨率导出，导出瞬间的内存峰值不可避免（一次一张）。如需要，可增加"导出长边限制"选项。
- **HEIC/AVIF**：浏览器不支持解码的格式会进入"解码失败"统计并提示，不做格式转换（避免引入 wasm 解码器，破坏零依赖）。
- **ESM 请求数**：若目标环境是 HTTP/1.1 且首屏 RTT 敏感，可加一步 esbuild 打包；当前取舍是"零构建、可直接托管"。
- **压缩算法**：PNG 已是压缩格式，deflate 收益通常 1–5%，故设了 1 KB 与"收益为正"双阈值，避免白耗 CPU。
