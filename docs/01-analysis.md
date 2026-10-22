# 01 · 代码分析与问题清单

> 评估对象：`cuijianzhuang/photo-watermark`（fork 自 `jzsn2018/offline-photo-watermark`）
> 快照：`master` @ `b7139f5`，仓库更新时间 2026-10-17
> 手写代码规模：`index.html` 161 行 + `css/styles.css` 1440 行 + `js/script.js` 1722 行 = 3323 行
> 第三方代码：`js/jszip.min.js` 97.6 KB（JSZip 3.10.1，UMD）

---

## 一、代码结构

原仓库只有 4 个运行时文件，全部逻辑压在一个脚本里：

| 文件 | 行数/体积 | 实际职责 |
| --- | --- | --- |
| `index.html` | 161 行 / 8.1 KB | 页面骨架；同时混入大量内联 `style` 与 `onclick` |
| `css/styles.css` | 1440 行 / 23.5 KB | 全部样式；尾部存在整段复制与未闭合的嵌套 `@media` |
| `js/script.js` | 1722 行 / 59.4 KB | 绘制算法 + DOM 绑定 + 文件读取 + 导出 + 预览 + 主题 + ZIP 分块 |
| `js/jszip.min.js` | 97.6 KB | 仅用于批量导出时打包 |
| `Dockerfile` + 4 个 `*.sh` | — | `python -m http.server` 起静态服务 |
| `.github/workflows/static.yml` | — | GitHub Pages 部署 |

### 运行时模块图（现状）

```
index.html
  └─ script.js  ──┬─ 全局变量（$ / canvas / allCanvas / configInputSetting ...）
                  ├─ readFile(file)            FileReader → Image → canvas（原尺寸）
                  ├─ drawText(canvas, img)     换行 + 平铺/单个/自定义 几何计算
                  ├─ allCanvas[]               每张图一张原尺寸 canvas 常驻
                  ├─ downloadCanvasAsImage     toDataURL → dataURItoBlob → <a download>
                  ├─ downloadAll()             内存分块并发 + JSZip（含 CDN 兜底）
                  ├─ showPreview()             createImageBitmap → OffscreenCanvas → toBlob → Image
                  └─ 主题 / Toast / 快捷键     各自散落的 DOMContentLoaded 监听
```

### 核心功能与算法

1. **字号自适应**：`textSize = max(12, size × max(15, √(w²+h²)/25))`，字号随画布对角线缩放。
2. **文字换行**：按正则切段（中文串、英文串、数字/日期串、标点、其他符号），再按 `measureText` 逐段试探；同时处理"标点不能出现在行首"（回溯贴上一行）与"超长段按字符硬切"。
3. **平铺布局**：以画布中心为原点旋转，在 ` diagonal × diagonal` 的正方形网格内铺满；
   `xStep = 最长行宽 + measureText('啊').width`，`yStep = space × (总行高 + 字号)`。
4. **单个布局**：`padding = min(w,h) × 0.1`，按居中/四角计算锚点，围绕锚点旋转绘制。
5. **自定义数量**：`cols = ceil(√(count × w / h))`，`rows = ceil(count / cols)`，在去掉 padding 的区域内等距布点。
6. **导出**：单张 `toDataURL('image/png')`；批量按"设备内存"决定 3/5/10 并发，全部生成后再交给 JSZip。

### 业务完整流程

```
选择/拖拽/粘贴
   → isImageTypeSupported()（仅看扩展名，alert 报错）
   → FileReader.readAsDataURL（base64 读入内存，进度条按字节）
   → new Image().src = dataURL → onload
   → 创建 <canvas width=naturalWidth height=naturalHeight>
   → drawImage 整幅 → drawText 叠水印 → 存入 allCanvas
   → 卡片插入 #graph（grid 布局）
   → 任意参数 input  →  forEach(allCanvas) → drawText 全量重绘
   → 点击卡片 → 预览（重新编码一份 JPEG）
   → 单张下载 / 复制 / 下载全部（ZIP）
   → 删除单张 / 删除全部（alert 确认）
```

---

## 二、问题清单

严重度定义：**严重** = 违背产品核心承诺或必然导致数据/安全问题；**高** = 明显影响主流程或性能；**中** = 影响体验、可维护性或边界场景；**低** = 规范/细节问题。

### A. 过时依赖与废弃/误用 API（10 项）

| 编号 | 严重度 | 位置 | 问题 | 影响 |
| --- | --- | --- | --- | --- |
| A1 | 高 | `js/jszip.min.js` | JSZip 3.10.1 以 UMD 全局脚本内联，97.6 KB，占全部 JS 的 62%，只为"打包 zip"一件事 | 首屏体积翻倍；UMD 全局无模块边界；而现代浏览器已有原生 `CompressionStream('deflate-raw')` |
| A2 | 中 | `script.js:799` | `navigator.deviceMemory` 是 Chromium-only、需安全上下文的实验特性，实际恒为 `undefined` | "按内存分块"策略永远走默认值 4，等于没写 |
| A3 | 中 | `script.js:767,789` | 创建 `AbortController` 但从未把 `signal` 传给任何异步 API，取消只靠标志位轮询 | "取消下载"只停了循环，进行中的编码/压缩仍在跑 |
| A4 | 中 | 9 处 | 用 `alert()` / `confirm()` 承担全部错误与确认（596、643、707、716、720、734、742、1030、1720） | 阻塞主线程、样式不可控、移动端体验差，且无法承载"撤销"这类复合交互 |
| A5 | 中 | `1415`、`1667`、`1682` | `insertAdjacentHTML` 拼接 HTML 字符串，其中含 `onclick="…"` 内联事件 | 与严格 CSP 不兼容，属于"可注入即执行"的模式 |
| A6 | 低 | `styles.css:111` | CSS 里写 `draggable: true` —— 不是合法 CSS 属性；卡片也没有 `draggable="true"` 属性 | "拖拽排序"功能从未生效 |
| A7 | 低 | `index.html:119` | `<input type="color" pattern="#[0-9A-Fa-f]{6}">`，`pattern` 对 color 类型无效 | 无效属性，误导维护者 |
| A8 | 低 | `index.html:7-21、116-139` | 缺 `<html lang>`、缺 `<body>`；主题按钮直接挂在 `<html>` 下；`<p>` 里嵌 `<label>/<input>` | 依赖浏览器容错解析，语义错误，影响读屏与 SEO |
| A9 | 中 | `DOMContentLoaded` 内 | 主题在 DOM 解析完成后才写入 `data-theme` | 深色模式用户首屏白闪（FOUC） |
| A10 | 低 | `script.js:11` | `allCanvas = []` 未声明（隐式全局）；`$`、`canvas` 等 12 个变量共享全局作用域 | 在 strict/module 下直接抛错；命名冲突风险 |

### B. 性能瓶颈（9 项）

| 编号 | 严重度 | 位置 | 问题 | 影响 |
| --- | --- | --- | --- | --- |
| B1 | 高 | `script.js:603-615` | 任意参数 `input` 事件都同步 `forEach` 重绘**所有** canvas，无 `requestAnimationFrame`、无防抖、无脏标记 | 拖一次滑块 = 30~60 次 × N 张图 × 全尺寸重绘。实测单张 12MP 重绘 20.9 ms，20 张时单次输入事件约 418 ms，必然掉帧、滑块"粘手" |
| B2 | 高 | `readFile` | 每张图常驻一张原尺寸 canvas（4000×3000 ≈ 48 MB 位图），且无数量/像素上限 | 20 张 ≈ 0.96 GB，移动端与低内存设备直接崩溃 |
| B3 | 中 | `script.js:46-53` | 清屏方式为"重新赋值 `canvas.width`"，会重置全部绘图状态并强制整幅 `drawImage` | 无法只重绘水印层，每次都全量重画 |
| B4 | 中 | `script.js:1291-1350` | 预览链路 4 次拷贝：`createImageBitmap → OffscreenCanvas → toBlob → new Image → objectURL` | 大图预览要数百毫秒，还额外占一份全尺寸内存 |
| B5 | 中 | `script.js:17-28,55-62` | 单张下载走 `toDataURL` 再 `atob` 还原成 Blob | base64 多占 33% 内存，纯绕路 |
| B6 | 中 | `script.js:799+` | 批量导出按"内存"并发 3/5/10 张，同时持有多个全尺寸 canvas 与 Blob，最后一次性交给 JSZip | 峰值内存叠加，正是 B2 崩溃的放大器 |
| B7 | 低 | `script.js:492` | 平铺模式在双层循环内逐格 `measureText` | 12MP 默认参数下单次重绘 133 次测量，其中 128 次与文字段数 1:1 重复 |
| B8 | 低 | `script.js:1589` | 用 `item.canvas.toDataURL() === previewImage.src` 判断当前预览项 | 每次按键对每张 canvas 做一次 base64 编码 |
| B9 | 低 | 全文 | 3 个独立 `DOMContentLoaded` 监听分别初始化同一批控件，初始化顺序隐式依赖 | 逻辑分散，容易重复绑定 |

### C. 安全与隐私（6 项）

| 编号 | 严重度 | 位置 | 问题 | 影响 |
| --- | --- | --- | --- | --- |
| C1 | **严重** | `script.js:1706-1712,1720` | 本地 `jszip.min.js` 加载失败时会从 `cdnjs.cloudflare.com` 动态插入 `<script>` 拉取，失败还弹"请检查网络连接" | 直接违背"无任何网络请求"的产品承诺——而用户正是在处理身份证这类图片时看到"请检查网络"，会把"页面正在联网"当成正常现象。同时引入无 SRI 的第三方脚本供应链风险 |
| C2 | 高 | 全站 | 无 CSP、无任何安全响应头，配合 A5 的内联事件与 HTML 拼接 | 任何一处注入即等于执行 |
| C3 | 高 | 批量导出段 | ZIP 条目名直接使用用户文件名，未过滤 `../`、绝对路径、控制字符、Windows 非法字符 | zip-slip：解压时可写到目标目录之外；非法字符导致解压失败 |
| C4 | 中 | `readFile` | 无文件体积/数量/像素上限，任意大文件直接进内存 | 一个 500 MB 的 PNG 即可让标签页 OOM，等同本地 DoS |
| C5 | 中 | `script.js:1170-1195` | 全局 `paste` 监听无条件 `preventDefault()`；分支中引用未定义变量 `newText`（1188） | 破坏页面所有正常粘贴；触发即抛 `ReferenceError` |
| C6 | 低 | 全站 | 缺 `Referrer-Policy`、`X-Content-Type-Options` 等基线头；外链无 `rel="noopener"` | 最小暴露原则不满足 |

### D. 正确性缺陷（6 项）

| 编号 | 严重度 | 位置 | 问题 | 影响 |
| --- | --- | --- | --- | --- |
| D1 | 高 | `script.js:1187-1188` | `textInput.value = newText`，而 `newText` 那行被注释掉了 | 在"水印文字"框里粘贴必然抛 `ReferenceError`，且因已 `preventDefault`，粘贴内容也丢了 |
| D2 | 高 | `script.js:1378` 与 `1555` | 两个 `keydown` 监听都处理预览的 `←/→` | 一次按键执行两次切换，表现为"按了没反应/跳两张" |
| D3 | 高 | 批量导出段 | ZIP 条目名 = 原始文件名，重名直接覆盖 | 两张同名图（如不同目录的 `IMG_0001`）打包后只剩一张，属静默丢数据 |
| D4 | 中 | 文件尾部 | 死代码：`new WatermarkUI()`、`new FileHandler()` 调用不存在的方法；`deleteBtn` 回调引用未定义的 `canvas`、`container` | 每次打开页面控制台都有 `TypeError`，并让"撤销删除"不可用 |
| D5 | 中 | `lastDeletedCanvas` | 撤销栈只存"最后一张被删的 canvas"，且与 D4 耦合 | "删除全部"实际不可撤销 |
| D6 | 低 | `generateFileName` | 文件名拼成 `IMG_0001.jpg_2026-10-22 0016.png`（含空格、保留原扩展名） | 跨平台不友好，批量下载后难与原件对应 |

### E. 可维护性（5 项）

| 编号 | 严重度 | 问题 |
| --- | --- | --- |
| E1 | 高 | 单文件 1722 行，工具函数、DOM 查询、事件绑定、绘制算法、导出、预览、ZIP 分块、主题全部混在一起，无模块边界 |
| E2 | 高 | 状态来自 DOM：`configInputSetting` 保存的是元素引用，绘制时逐次读 `.value`。UI 与算法强耦合，算法无法单测 |
| E3 | 中 | 重复代码：`styles.css:1190-1440` 把 `.download-progress`、`.progress-*`、`.preview-nav`、`:root` 整段复制进嵌套 `@media`，且文件尾部存在未闭合的嵌套块；JS 中平铺与单个的绘制逻辑各写一遍 |
| E4 | 中 | 无测试、无 lint、无构建校验；回归只能靠人工点击 |
| E5 | 低 | 注释与文档不一致（文件头 `@LastEditors`；README 写 MIT，`LICENSE` 实际是 GPL-3.0） |

### F. 体验与可访问性（8 项）

| 编号 | 严重度 | 问题 |
| --- | --- | --- |
| F1 | 中 | 无空状态与示例预览：未上传时右侧空白，改参数没有任何反馈，用户不知道"效果长什么样" |
| F2 | 中 | 只有旋转角度有数值回显；透明度/字号/间距改了不知道具体值 |
| F3 | 中 | 12 个参数平铺在一条纵向长表单里，层级只靠"第一步/第二步/第三步"三段文字，移动端要滚很久 |
| F4 | 中 | 无可访问性：canvas 无 `aria`、点图预览不是按钮、弹窗无 `role`/焦点管理、色板与位置选择无标签、无 `aria-live` |
| F5 | 中 | 报错与确认全靠 `alert/confirm`，删除不可撤销（`Ctrl+Z` 残缺，见 D5） |
| F6 | 低 | 页面含作者信息与外链（页脚 + 正文），与"工具页"定位不符 |
| F7 | 低 | 主题仅手动切换、不跟随系统；切换按钮固定右上角，与内容存在重叠风险 |
| F8 | 低 | 快捷键说明靠注入 HTML 实现（与 A5 冲突），无独立入口 |

### 统计

| 类别 | 数量 | 严重 | 高 | 中 | 低 |
| --- | --- | --- | --- | --- | --- |
| A 过时依赖 / API 误用 | 10 | 0 | 1 | 5 | 4 |
| B 性能瓶颈 | 9 | 0 | 2 | 4 | 3 |
| C 安全与隐私 | 6 | 1 | 2 | 2 | 1 |
| D 正确性缺陷 | 6 | 0 | 3 | 2 | 1 |
| E 可维护性 | 5 | 0 | 2 | 2 | 1 |
| F 体验与可访问性 | 8 | 0 | 0 | 5 | 3 |
| **合计** | **44** | **1** | **10** | **20** | **13** |

---

## 三、评估结论

| 评估维度 | 评分（10 分制） | 说明 |
| --- | --- | --- |
| 产品定位与隐私设计 | 7 | 思路正确（纯本地 canvas），但 C1 的 CDN 兜底把承诺打了折 |
| 功能完整度 | 7 | 布局、样式、批量、主题齐备；但批量重名丢文件、粘贴报错、预览翻页失灵 |
| 性能与资源占用 | 3 | 全量同步重绘 + 原尺寸 canvas 常驻，20 张图即接近不可用 |
| 安全性 | 4 | 无 CSP、HTML 拼接、zip-slip、无输入上限，仅"不联网"这一点是加分项 |
| 工程质量 | 2 | 单文件 1722 行、状态存在 DOM 里、死代码、无测试、CSS 后半段是复制粘贴 |
| 可访问性与体验 | 4 | 有响应式与深色模式，但缺少焦点管理、语义结构与空状态引导 |
| **综合** | **4.5 / 10** | 能用、思路对，但属于"个人脚本"水平的实现，不适合直接作为长期维护的产品页面 |

**一句话结论**：这是一个定位清晰、思路正确（浏览器本地处理）的原型级工具，核心绘制算法（字号自适应、换行规则、三种布局几何）是它真正的价值；但工程实现停留在单文件脚本阶段，存在 1 个违背隐私承诺的严重问题、10 个高优缺陷（性能、数据丢失、安全），且 UI 与算法强耦合导致无法单独验证。

因此升级策略不是"推倒重写功能"，而是：

1. **保留算法**——把绘制几何原样抽成纯函数，并用"逐字坐标比对"的回归测试锁死，确保水印效果 100% 不变；
2. **重建工程骨架**——按职责拆模块、参数收敛为单一状态源、DOM 与算法解耦；
3. **消除结构性开销**——去掉 JSZip 与 CDN、缩放卡片底图、rAF 合并 + 视口内绘制、串行导出；
4. **补齐安全与体验**——严格 CSP、文件名净化、输入上限、可撤销删除、空状态示例、响应式与深色模式重做。

具体方案见 [02-upgrade.md](02-upgrade.md)。
