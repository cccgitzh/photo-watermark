# 03 · 项目文件结构与清单

## 一、目录树

```
photo-watermark/
├── index.html                    333 行 / 16.5 KB   页面骨架（语义化结构，零内联样式与内联事件）
├── favicon 由 assets/icon.svg 提供
│
├── assets/
│   └── icon.svg                   13 行 /   0.7 KB   站点图标（内联 SVG，无外部依赖）
│
├── css/
│   ├── base.css                  226 行 /   4.9 KB   设计令牌（颜色/字号/圆角/动效）、重置、排版、主题变量、滚动条
│   ├── layout.css                380 行 /   6.6 KB   顶栏、双栏栅格、卡片网格、空状态、页脚、响应式断点
│   └── components.css           1010 行 /  18.8 KB   按钮、输入、滑块、分段控件、位置选择、色板、卡片、灯箱、确认框、Toast
│
├── js/
│   ├── app.js                    422 行 /  12.6 KB   唯一装配点：文件来源（选择/拖拽/粘贴）、导入队列、撤销栈、批量导出、快捷键
│   ├── state.js                  132 行 /   3.7 KB   参数唯一来源：默认值、取值范围、归一化、订阅、localStorage 持久化
│   ├── controls.js               166 行 /   5.8 KB   表单 ↔ store 双向绑定、数值回显、方向键单选
│   ├── gallery.js                441 行 /  14.0 KB   卡片列表、拖拽排序、IntersectionObserver 懒绘制、示例画布
│   ├── items.js                  275 行 /   8.4 KB   图片解码（ImageBitmap 优先）、卡片画布、全分辨率导出、文件名净化
│   ├── watermark.js              157 行 /   5.7 KB   ★ 绘制引擎：字号缩放、平铺/单个/自定义几何（纯函数）
│   ├── text-layout.js            135 行 /   3.9 KB   ★ 换行算法：分段、标点回溯、超长段硬切（纯函数）
│   ├── zip.js                    209 行 /   6.8 KB   零依赖 ZIP：CRC32、deflate-raw/STORE、UTF-8 文件名
│   ├── exporter.js                83 行 /   2.7 KB   单张下载、复制到剪贴板、批量打包（串行 + AbortSignal）
│   ├── preview.js                146 行 /   4.1 KB   <dialog> 灯箱：按需生成、键盘/滑动翻页、URL 回收
│   ├── ui.js                     130 行 /   4.0 KB   Toast（含撤销动作）、Promise 化确认框
│   ├── theme.js                   54 行 /   1.6 KB   主题模式（system/light/dark）、系统偏好联动
│   └── theme-init.js              19 行 /   0.8 KB   首屏同步应用主题（防闪白，外置以兼容 CSP）
│
├── scripts/
│   └── serve.mjs                  92 行 /   3.3 KB   零依赖静态服务器（安全头、MIME、目录穿越防护）
│
├── tests/
│   ├── watermark.test.mjs        148 行 /   4.8 KB   几何等价性回归（旧算法 vs 新算法逐字坐标比对）
│   ├── text-layout.test.mjs       64 行 /   2.4 KB   换行规则回归（20 段文本 × 5 档宽度 × 4 档字号）
│   ├── zip.test.mjs              140 行 /   5.1 KB   ZIP 回环校验（自解析 + CRC + 解压内容比对）
│   ├── legacy.mjs                231 行 /   7.7 KB   旧算法逐行移植（仅测试用基准）
│   └── harness.mjs               112 行 /   3.1 KB   记录型 2D context（变换矩阵 + 绝对坐标）
│
├── docs/
│   ├── 01-analysis.md                       分析与问题清单（44 项）
│   ├── 02-upgrade.md                        升级方案与量化对比
│   ├── 03-structure.md                      本文件：文件结构与清单
│   ├── 04-deploy.md                         部署实施步骤
│   └── preview.png                          界面预览图（README 引用，不参与部署）
│
├── .github/workflows/deploy.yml   55 行            GitHub Pages 自动部署（先跑测试再发布）
├── Dockerfile                     16 行            nginx:1.27-alpine，仅复制运行时文件
├── docker-compose.yml             16 行            端口 8080，只读根文件系统
├── nginx.conf                     47 行            安全响应头、gzip、缓存策略
├── package.json                   16 行            仅 scripts（dev/start/test），无依赖
├── LICENSE                                       GPL-3.0（沿用上游许可）
├── README.md                      87 行            项目说明
├── .gitignore / .dockerignore / .editorconfig
```

**运行时产物（真正会被部署的）只有 4 项**：`index.html`、`css/`、`js/`、`assets/`，合计 **约 119 KB**、18 个文件（1 + 3 + 13 + 1）。

---

## 二、按职责分组

| 分组 | 文件 | 说明 |
| --- | --- | --- |
| **算法层（无 DOM 依赖，可单测）** | `watermark.js`、`text-layout.js` | 唯一决定"水印长什么样"的代码；任何改动都必须过 `watermark.test.mjs` |
| **数据层** | `state.js`、`items.js` | 参数状态与图片实体；`items.js` 负责解码/导出这类重 IO |
| **视图层** | `gallery.js`、`preview.js`、`controls.js`、`ui.js`、`theme.js` | 只做"把状态画出来 / 把操作写回状态" |
| **基础设施** | `zip.js`、`exporter.js`、`theme-init.js` | 打包、下载、首屏引导 |
| **装配** | `app.js` | 唯一把上述模块连起来的地方；想了解整体行为从这里读 |
| **样式** | `css/base.css` → `layout.css` → `components.css` | 令牌 → 骨架 → 组件，加载顺序即依赖顺序 |
| **工程** | `tests/`、`scripts/serve.mjs`、Dockerfile、nginx.conf、workflow | 测试、本地预览、部署 |

---

## 三、相对原仓库的变更清单

### 新增（21 个文件）

| 文件 | 作用 |
| --- | --- |
| `css/base.css`、`css/layout.css`、`css/components.css` | 替代原单文件 `css/styles.css`（含重复段与未闭合块） |
| `js/state.js` | 参数唯一来源（原为散落的 DOM 读取） |
| `js/watermark.js` | 绘制引擎（原混在 `script.js` 中） |
| `js/text-layout.js` | 换行算法（原混在 `script.js` 中） |
| `js/items.js` | 解码/导出实体（原为 `readFile` + 全局 `allCanvas`） |
| `js/gallery.js` | 列表与懒绘制（原为直接操作 `#graph`） |
| `js/preview.js` | `<dialog>` 灯箱（原为手写遮罩 + 双份键盘监听） |
| `js/exporter.js` | 下载/复制/批量（原混在 `script.js`） |
| `js/zip.js` | 零依赖 ZIP（替代 JSZip） |
| `js/controls.js` | 表单绑定（原为 `configInputSetting` 元素字典） |
| `js/ui.js` | Toast + 确认框（替代 9 处 `alert/confirm`） |
| `js/theme.js`、`js/theme-init.js` | 主题（原为 DOMContentLoaded 内联逻辑，有闪白） |
| `js/app.js` | 装配 + 导入队列 + 撤销栈 + 快捷键 |
| `assets/icon.svg` | 重新设计的站点图标（原 `favicon.svg` 为第三方图标库产物） |
| `scripts/serve.mjs` | 零依赖本地服务器（原用 `python -m http.server`） |
| `nginx.conf` | 安全响应头 + gzip + 缓存策略 |
| `docker-compose.yml` | 一条命令起服务 |
| `tests/*`（5 个） | 回归测试与基准 |
| `docs/*`（4 个） | 分析、方案、清单、部署 |

### 删除（8 项）

| 删除内容 | 原因 |
| --- | --- |
| `js/jszip.min.js`（97.6 KB） | 用原生 `CompressionStream` 替代，同时消除 CDN 兜底 |
| `js/script.js`（1722 行） | 拆分为上表 12 个模块；死代码（`WatermarkUI`/`FileHandler`/`deleteBtn` 等）一并清除 |
| `css/styles.css`（1440 行） | 重写为三个分层文件，删掉 `1190-1440` 的重复段与未闭合嵌套块 |
| `favicon.svg` | 换成自绘 `assets/icon.svg`（原文件为第三方图标库导出，含冗余命名空间） |
| `snapshot/img.png`（91 KB） | 仓库截图，与运行时无关（README 也不再引用外链图片） |
| `build.sh`、`deploy.sh`、`run.sh`、`stop.sh` | 合并为 `docker compose up -d` / `down` |
| `.github/workflows/static.yml` | 由 `deploy.yml` 替代（先跑测试、只发布运行时文件、分支改为 `main`） |
| 页面中的作者信息、GitHub 链接、页脚版权 | 按要求移除；页脚改为隐私与导出说明 |

### 保留（等价迁移）

| 内容 | 说明 |
| --- | --- |
| 全部水印参数与默认值 | 文字、颜色 `#ffffff`、透明度 `0.3`、间距 `1.5`、字号 `0.8`、角度 `45`、平铺、居中、黑体、非粗斜体 |
| 三种布局算法 | 平铺 / 单个（5 位置）/ 自定义数量，公式逐行保留 |
| 换行算法 | 分段正则、标点回溯、`maxWidth × 1.1` 容差、超长段硬切 |
| 12 种字体族 | 顺序与取值完全一致（保证同一台机器上渲染相同） |
| 导出格式 | PNG、原图分辨率 |
| 支持的图片格式 | JPG / PNG / GIF / WebP / BMP / ICO |
| 深色模式、响应式、拖拽上传、粘贴上传 | 全部保留并修复 |
| `LICENSE` | 原样保留 GPL-3.0 |

---

## 四、代码规模对比

| 指标 | 原版 | 新版 | 说明 |
| --- | --- | --- | --- |
| 手写源码行数 | 3323 | 4886 | 增加的部分主要是注释、JSDoc、类型契约与可访问性属性 |
| 运行时字节 | ≈197 KB | ≈119 KB | −38%，主因是移除 JSZip |
| JS 字节 | 158.4 KB（压缩后，含 JSZip） | 74.1 KB（未压缩、可读） | −53% |
| CSS 字节 | 23.5 KB | 30.3 KB | +29%，但拆为 3 层、删除全部重复段 |
| 最大单文件行数 | 1722（script.js） | 441（gallery.js） | 单文件复杂度显著下降 |
| 第三方运行时依赖 | 1（JSZip） | 0 | — |
| 测试用例 | 0 | 16（全部通过） | `node --test` |
| 控制台报错 | 每次加载 1 个 TypeError | 0 | 冒烟测试验证 |
