# 04 · 部署实施步骤

> 目标：把升级后的项目发布到**你自己的 GitHub 仓库**，并跑在 GitHub Pages 上；另附 Docker 与自建 Nginx 两条备选路径。
> 全程不需要 `npm install`——项目零依赖，构建产物就是源文件本身。

---

## 0. 前置条件

| 工具 | 版本 | 用途 | 检查命令 |
| --- | --- | --- | --- |
| Git | ≥ 2.30 | 版本管理 | `git --version` |
| Node.js | ≥ 18（推荐 20/22） | 跑测试、本地预览 | `node -v` |
| GitHub 账号 | — | 托管 | — |
| `gh` CLI（可选） | ≥ 2.40 | 免网页建仓 | `gh --version` |

---

## 1. 本地验收（发布前必做）

```bash
cd photo-watermark

# 1.1 单元测试：16 个用例，应全部 pass
node --test

# 1.2 本地起服务
node scripts/serve.mjs 8080
# 打开 http://localhost:8080
```

手工验收清单（约 3 分钟）：

- [ ] 首屏有示例画布，拖动任意滑块，示例上的水印实时变化
- [ ] 选择 3 张以上图片（或直接 `Ctrl/⌘+V` 粘贴截图），卡片按顺序出现，右下角显示尺寸
- [ ] 切换「平铺 / 单个 / 自定义」，位置九宫格与数量输入正确联动
- [ ] 点击卡片打开灯箱，`←` `→` 一次切一张，`Esc` 关闭
- [ ] 单张「下载」得到 `原名.png`，尺寸与"原图一致"
- [ ] 「下载全部」得到 `水印图片_<时间戳>.zip`，解压后每张图都有水印
- [ ] 删除一张 → Toast 出现「撤销」→ 点击可恢复；`Ctrl/⌘+Z` 同样有效
- [ ] 顶栏切换到深色模式后**刷新页面**，不出现白闪
- [ ] DevTools → Network 面板：**没有任何外部域请求**（只有本机地址）
- [ ] DevTools → Console：无报错

---

## 2. 初始化 Git 仓库并提交

项目目录已是可直接提交的干净状态（`.gitignore` 已排除 `.tmp/`、`node_modules`、`_site`）。

```bash
cd photo-watermark

git init -b main
git add .
git commit -m "feat: 重构升级图片水印工具（零依赖 + 性能与安全加固）"

# 确认没有把临时文件带进来
git status --short
git ls-files | wc -l      # 预期 39 个文件（含 docs/ 与 tests/）
```

> 如果仓库里出现了 `.tmp/` 下的内容，执行 `git rm -r --cached .tmp` 再提交。

---

## 3. 在 GitHub 创建仓库

### 方式 A：网页创建（最稳）

1. 打开 GitHub → 右上角 **+** → **New repository**
2. **Repository name** 填 `photo-watermark`（可自定义）
3. 可见性选 **Public**（Pages 免费账号需要公开仓库；Pro 可用私有仓库）
4. **不要**勾选 *Add a README / .gitignore / license*（本地已有，避免冲突）
5. 点 **Create repository**，页面会给出一段推送命令

### 方式 B：`gh` CLI 一条命令

```bash
gh auth login          # 首次需要
gh repo create photo-watermark --public --source=. --remote=origin --push
```

---

## 4. 推送到远端

```bash
git remote add origin https://github.com/<你的用户名>/photo-watermark.git
git branch -M main
git push -u origin main
```

> 用 SSH 的话地址换成 `git@github.com:<你的用户名>/photo-watermark.git`。

---

## 5. 开启 GitHub Pages（自动部署）

1. 进入仓库 → **Settings** → 左侧 **Pages**
2. **Build and deployment → Source** 选择 **GitHub Actions**（不要选 *Deploy from a branch*）
3. 回到 **Actions** 标签页，应能看到 `Deploy to GitHub Pages` 工作流已因刚才的 push 自动运行
4. 工作流包含三步关键动作：`node --test`（测试不过不发布）→ 组装 `_site/`（只含 `index.html`、`css/`、`js/`、`assets/`）→ 部署
5. 首次运行约 40~90 秒；成功后访问：

```
https://<你的用户名>.github.io/photo-watermark/
```

6. （可选）绑定自定义域名：**Settings → Pages → Custom domain** 填域名，并在 DNS 加 `CNAME` 记录指向 `<你的用户名>.github.io`

**注意事项**

- 工作流监听 `main` 分支。若你的默认分支是 `master`，请改 `.github/workflows/deploy.yml` 里的 `branches: [master]`，或用 `git branch -M main` 重命名。
- 项目所有资源都是相对路径，部署在 `/<仓库名>/` 子路径下无需改任何配置。
- Pages 由 Actions 产物直出，不经过 Jekyll，无需 `.nojekyll`。
- Pages 无法自定义响应头，因此安全头以 `<meta http-equiv="Content-Security-Policy">` 的形式写在 `index.html` 里，效果等同（`frame-ancestors` 除外）。

---

## 6. 部署后线上验证

```bash
# 1) 页面可达
curl -I https://<你的用户名>.github.io/photo-watermark/

# 2) 关键资源 200
curl -o /dev/null -w "%{http_code} css\n" https://<你的用户名>.github.io/photo-watermark/css/base.css
curl -o /dev/null -w "%{http_code} js\n"  https://<你的用户名>.github.io/photo-watermark/js/app.js
```

浏览器里再确认：

- [ ] 打开页面无 404（Network 里除本站外**没有第三方域名**）
- [ ] Console 无 CSP 违规、无报错
- [ ] 手机浏览器访问，布局为单列、工作区在最前、无横向滚动
- [ ] 上传 2 张图 → 下载全部 → 解压可用

---

## 7. EdgeOne Makers 部署

EdgeOne（腾讯云边缘安全加速平台）的 Makers 支持**直传静态目录**，不需要绑定 Git 仓库。本项目已按此方式部署。

### 7.1 命令

```bash
# 1) 先组装只含运行时文件的目录（避免把 .git / tests / docs 一起上传）
rm -rf _site && mkdir -p _site
cp index.html _site/ && cp -r css js assets _site/

# 2) 部署（-n 是项目名，首次会自动创建）
export PAGES_SOURCE=skills
edgeone makers deploy _site -n photo-watermark --json
```

成功时最后一行是单行 JSON：

```json
{"status":"success","url":"https://photo-watermark.edgeone.cool","type":"preset",
 "projectId":"makers-xxxx","deploymentId":"dp-xxxx","consoleUrl":"https://console.tencentcloud.com/..."}
```

常用变体：

```bash
edgeone makers deploy _site -n photo-watermark -e preview   # 部署到预览环境（每次生成独立子域名）
edgeone makers deploy _site -n photo-watermark -a overseas  # 部署到海外区域
```

### 7.2 本次部署记录

| 项 | 值 |
| --- | --- |
| 项目名 | `photo-watermark` |
| 项目 ID | `makers-uieyar1sq6g2` |
| 默认域名 | `https://photo-watermark.edgeone.cool` |
| 控制台 | <https://console.tencentcloud.com/edgeone/pages/project/makers-uieyar1sq6g2> |
| 上传内容 | `_site/`，18 个文件约 119 KB（不含 `.git`、`tests/`、`docs/`） |

### 7.3 默认域名的访问限制（重要）

直接访问 `https://photo-watermark.edgeone.cool` 会返回 **401**，响应头 `X-EOP-MSG: eo_time missing`，页面提示：

> 401 : UNAUTHORIZED — Access Restricted or Authentication Expired.
> Site Visitor: contact the site administrator to obtain a valid access link.
> Site Owner: Click "Preview" in the console for a new link.

原因是 EdgeOne Makers 的默认域名（`*.edgeone.cool` / `*.edgeone.dev`）对匿名访客启用了访问校验：必须带上 `?eo_token=<令牌>&eo_time=<时间戳>`，而这对参数由控制台「预览」按钮按域名实时签发（平台接口 `DescribePagesEncipherToken`），CLI 不会长期保存。

三种处理方式，按场景选：

| 场景 | 做法 |
| --- | --- |
| 自己验收 / 给同事临时看 | 控制台 → 项目 → 右上角 **预览**，复制带 `eo_token` 的完整链接（**必须整条复制，去掉查询参数就会 401**） |
| 长期公开访问 | 控制台 → **域名管理** → 绑定**已备案**的自定义域名，绑定成功后访问地址变为 `https://你的域名`，不再需要令牌 |
| 仅需一个公开演示地址 | 直接用 GitHub Pages（第 5 节），本项目已启用：<https://cccgitzh.github.io/photo-watermark/> |

> 补充：`-a overseas` 部署到海外区域同样受该校验，且「Global（不含中国大陆）」区域的默认域名在中国大陆访问可能被限速或拦截，正式对外服务建议还是走已备案的自定义域名。

### 7.4 更新发布

```bash
# 改了源码后
node --test                       # 先跑测试
git add -A && git commit -m "..." && git push    # 同步到 GitHub（同时触发 Pages 重建）

# 重新组装并发布到 EdgeOne
rm -rf _site && mkdir -p _site
cp index.html _site/ && cp -r css js assets _site/
export PAGES_SOURCE=skills
edgeone makers deploy _site -n photo-watermark --json
```

`.edgeone/`（本地项目链接）与 `_site/`（发布产物）都已写入 `.gitignore`，不会进仓库。

---

## 8. 备选：Docker 部署

```bash
# 构建 + 启动
docker compose up -d --build

# 查看状态（含健康检查）
docker compose ps

# 访问 http://localhost:8080
docker compose logs -f
```

细节：

- 镜像基于 `nginx:1.27-alpine`，只把 `index.html / css / js / assets` 复制进去，镜像约 20 MB
- `nginx.conf` 下发完整安全响应头（CSP、nosniff、Referrer-Policy、Permissions-Policy、COOP/CORP）与 gzip
- `docker-compose.yml` 使用只读根文件系统 + `tmpfs` 承载 nginx 临时目录，`no-new-privileges`
- 改端口：编辑 `docker-compose.yml` 的 `ports`，如 `"80:8080"`

停止 / 清理：

```bash
docker compose down            # 停止并移除容器
docker compose down --rmi local  # 同时删除本地镜像
```

---

## 9. 备选：自建 Nginx / 任意静态服务器

```bash
# 1) 把运行时文件同步到站点目录
rsync -av --delete index.html css js assets/ /var/www/photo-watermark/

# 2) 使用仓库自带的 nginx.conf（注意它监听 8080，按需改 listen）
sudo cp nginx.conf /etc/nginx/conf.d/photo-watermark.conf
sudo nginx -t && sudo systemctl reload nginx
```

其它平台：

| 平台 | 做法 |
| --- | --- |
| Vercel / Netlify | 新建项目指向该仓库，Build Command 留空，Output Directory 填 `.` |
| Cloudflare Pages | 同上，Framework preset 选 *None* |
| 对象存储（OSS/COS/S3） | 上传 `index.html`、`css/`、`js/`、`assets/`，index 文档设为 `index.html`，MIME 里确保 `.js` 为 `text/javascript` |
| 内网 | `python -m http.server 8080` 或 `npx serve .` 也可，仅缺少安全响应头 |

> 提示：`js/*.js` 必须以 `text/javascript` 返回，否则浏览器会拒绝执行 ES Module。

---

## 10. 后续更新与回滚

```bash
# 改完代码
node --test                      # 先本地跑测试
git add -A
git commit -m "fix: ..."
git push                         # push 即触发 Pages 自动发布

# 回滚到上一个可用版本
git revert <commit>              # 推荐：生成反向提交，保留历史
git push
```

发布后浏览器可能缓存 `css/js` 最长 1 小时（Nginx 配置）；Pages 侧由 GitHub 控制。急用时强刷（`Ctrl/⌘ + Shift + R`）。

---

## 11. 常见问题

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 双击 `index.html` 打开后页面在但按钮全无反应，Console 报 `Cross origin requests are only supported for protocol schemes` / `Failed to load module script` | ES Module 在 `file://` 下被 CORS 策略拦截 | 用 `node scripts/serve.mjs` 或任意 HTTP 服务器打开，不要双击 |
| Pages 打开是 404 | Source 未设为 GitHub Actions，或分支不是 `main`，或 Action 未成功 | 检查 Settings → Pages 与 Actions 运行记录 |
| 页面完全没样式 | `css/` 未随 `_site/` 上传（工作流被改过） | 确认 `Assemble site` 步骤包含 `cp -r css js assets _site/` |
| Console 报 `Refused to apply inline style` / `Refused to execute inline script` | 手动往 HTML 里加了内联 `style` 或 `onclick` | 改用 class 与 `addEventListener`（项目本身零内联） |
| 点"下载全部"没有任何文件 | 浏览器拦截了"多文件下载"或弹窗拦截 | 本项目只产生 1 个 zip，检查地址栏右侧的拦截图标；Safari 需允许下载 |
| 解压后中文名乱码 | 解压工具忽略 ZIP 的 UTF-8 标志位 | 用 7-Zip / macOS 归档工具 / Windows 11 资源管理器；本项目已置 bit 11 |
| 导出一张大图很慢、内存飙高 | 全分辨率 PNG 编码本身开销大（一次一张串行） | 属预期行为；必要时分批处理，或后续加"导出长边限制"选项 |
| 手机上卡片很小 | 网格最小列宽 132px（≤560px 断点） | 调整 `css/layout.css` 中 `.gallery` 的 `minmax()` |
| 想把默认水印文字改掉 | 默认值集中在 `js/state.js` | 改 `DEFAULT_CONFIG.text`；注意测试里的基准也是这个值 |

---

## 12. 一页速查

```bash
node --test                        # 测试
node scripts/serve.mjs 8080        # 本地预览
docker compose up -d --build       # 容器部署
git push                           # 触发 Pages 自动发布

# EdgeOne Makers：组装产物 → 部署
rm -rf _site && mkdir -p _site && cp index.html _site/ && cp -r css js assets _site/
PAGES_SOURCE=skills edgeone makers deploy _site -n photo-watermark --json
```

| 环境 | 地址 |
| --- | --- |
| GitHub 仓库 | <https://github.com/cccgitzh/photo-watermark> |
| GitHub Pages（公开） | <https://cccgitzh.github.io/photo-watermark/> |
| EdgeOne 控制台 | <https://console.tencentcloud.com/edgeone/pages/project/makers-uieyar1sq6g2> |
| EdgeOne 默认域名 | `https://photo-watermark.edgeone.cool`（匿名访问 401，需控制台「预览」拿带令牌链接，或绑定已备案域名） |
| 本地 | `http://localhost:8080` |
