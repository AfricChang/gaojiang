# 仓库改名记录（wenyan-pc → gaojiang / 稿匠）

> 状态：**已执行**（2026-09-01）
> 最终命名：仓库 `AfricChang/gaojiang` + `AfricChang/gaojiang-ui`；
> 包名 `@gaojiang/pc` + `@gaojiang/ui`；应用名 **稿匠**。
> 本文保留原计划正文作为执行依据，另见 §3.6「有意保留的标识」与 §6「实际执行记录」。

## 1. 背景与目标

当前仓库 `AfricChang/wenyan-pc` 是 [caol64/wenyan-pc](https://github.com/caol64/wenyan-pc)（Apache License 2.0）的 fork。
上游自分歧点（`503f12a`，2026-03-27）以来共 6 个 commit，截至 2026-09-01 已停更约 3 个月。
其中 5 个是把后端逻辑搬到 Rust 的连续重构（`src-tauri/src` 从 1 个文件变成约 25 个模块），
与本地 fork 的功能（Mermaid 导出、PDF 导出、视图模式、明暗切换、exe 构建）无交集，**确认不合并**；
且其中 `9f4ed04` 会移除本 fork 依赖的 `tauri-plugin-shell`（mermaid CLI）并恢复
`tauri-plugin-single-instance`（撤销多进程多开），合入反而有害。

唯一有价值的是 `9fc2515`（Tauri Updater 自动更新，仅 Windows）。
它自成一体、可脱离上游新架构移植（约 150 行 Rust + 30 行 TS），且其 `latest.json` 托管在 R2 ——
本仓库 release.yml 已在用 R2，基础设施现成，只需补一对 Tauri 签名密钥。
**决定：改名完成后再单独安排移植，不走 merge。**

目标：将仓库改名为独立名称（如 `wenyan-pc-fork` / `wenyan-desktop` / 其他候选），
明确 fork 身份，避免与上游仓库混淆。

## 2. 合规性结论（Apache License 2.0）

- 改仓库名**不违反** Apache 2.0，改名反而更符合第 6 节商标条款（不得暗示官方背书）。
- 保留 Apache 2.0 许可证（`LICENSE` 文件与上游一致，无需改动）是唯一正确做法。
- 需继续履行的义务：
  1. 保留 LICENSE 全文 ✅（现状已满足）
  2. 保留出处说明 ✅（README 已有"基于上游 caol64/wenyan-pc 维护"）
  3. 修改文件显著标记（§4(b)）：以 README fork 说明覆盖 ✅
  4. 商标条款（§6(e)）：不得使用"文颜"名称/Logo 暗示官方背书 —— 见下方第 4 节

## 3. 执行步骤

> ⚠️ **先读 §3.5 的执行顺序再动手**。涉及两个仓库，顺序错了要多补一次子模块指针提交。

### 3.1 GitHub 平台操作
1. GitHub → 仓库 Settings → General → Repository name 改为新名称（GitHub 自动重定向旧链接）。
2. 本地同步远程地址：
   ```bash
   git remote set-url origin https://github.com/AfricChang/<新名称>.git
   git fetch origin
   ```
3. `wenyan-ui` 子模块指向 `AfricChang/wenyan-ui`，与本仓库改名互不影响；如 wenyan-ui 也改名，需同步 `.gitmodules`。
   ⚠️ 同步时**只改 `url`，务必保留 `path = wenyan-ui`**。有 5 处构建配置硬编码的是这个**目录名**而非仓库名，
   目录名不变则全部无需改动；一旦改了 `path`，下列都要同步：
   - `package.json:8`（`ui:init` 脚本 `cd wenyan-ui`）
   - `package.json:51`（`"@wenyan-md/ui": "file:./wenyan-ui"`，改后需重装依赖并更新 lockfile）
   - `svelte.config.js:16`（alias `./wenyan-ui/src/lib`）
   - `vite.config.ts:13,18`（alias 与 `fs.allow`）
   - `tailwind.config.js:5`（content 扫描路径）

### 3.2 代码/配置更新（改名后必做）
| 文件 | 当前值 | 建议 |
|---|---|---|
| `src-tauri/tauri.conf.json` `copyright` | `© 2024-2026 Lei Cao. All rights reserved.` | 改为自己的署名（Apache 2.0 署名义务） |
| `src-tauri/tauri.conf.json` `identifier` | `com.yztech.WenYan` | 改为独立 identifier（如 `com.<自己>.wenyan-pc`），避免与上游应用冲突 |
| `src-tauri/Cargo.toml:5` `authors` | `["caol64@gmail.com"]` | 改为自己的署名（与 `copyright` 一并处理，勿漏 Cargo 侧） |
| `package.json` `name` | `@wenyan-md/pc` | 可改为 `@<自己>/<新名>`（private 包，影响小） |
| `README.md:93` clone 命令 | `git clone --recursive https://github.com/caol64/wenyan-pc` | **必改**，指向 `AfricChang/<新名称>`。照当前命令 clone 拿到的是上游仓库，既无本 fork 的功能，也无本 fork 的子模块配置（本仓库 `.gitmodules` 指向 `AfricChang/wenyan-ui` 的 `feature/mermaid-support` 分支） |
| `README.md:9-10` 徽章 | License / Stars 徽章均指向 `caol64/wenyan-pc` | 两个都改（原计划只提了 Stars）；License 徽章指向本仓库更准确 |
| `README.md:7-8` 徽章 | 下载/文档徽章指向 yuzhi.tech | 确认下载徽章是否继续指向上游官网（本 fork 无自己的发布页则保留并注明） |
| `README.md:150-151` | Issue / PR 链接指向 `caol64/wenyan-pc` | 改为本仓库，否则 bug 会报到上游 |
| `.github/FUNDING.yml` | `buy_me_a_coffee: caol64`、`https://paypal.me/caol64`、`https://yuzhi.tech/sponsor` | **建议删除或改为自己的**。当前 fork 页面的 Sponsor 按钮把赞助导给上游作者，改名后更易被理解为"官方仓库"——正是第 4 节要规避的商标/背书风险 |

### 3.3 品牌区分（可选，降低商标混淆风险）
- 应用名 `productName: 文颜` 与图标（`app-icon.png`、`data/` 内 Logo）为上游素材。
  保留不违规，但如需彻底区分品牌，可考虑：
  - 改 `productName` 与窗口标题；
  - 替换应用图标与 README Logo；
  - 在 About 页注明 fork 关系（已有 `AboutPage.svelte` 可加一行）。

> 说明：`README.md:37-42` 的"项目家族"链接（wenyan / wenyan-cli / wenyan-mcp / wenyan-core 等）
> 指向上游是**正确的**，属于出处说明，不需要改。

### 3.4 本地工作目录改名（可选，但改了就必须连带处理）
GitHub 仓库改名不会动本地目录。若同时把本地目录从 `E:\github\wenyan-pc` 改名，
以下硬编码绝对路径会立即失效：

| 文件 | 内容 |
|---|---|
| `tools/wenyan-mermaid.cmd:4` | `set "WENYAN_PC_ROOT=E:\github\wenyan-pc"` |
| `tools/wenyan-mermaid-svg.cmd:4` | `set "WENYAN_PC_ROOT=E:\github\wenyan-pc"` |
| `tools/wenyan-mermaid-svg.md` | 4 处示例命令中的绝对路径（第 8、16、24、30 行） |

建议：要么保持本地目录名不变（最省事），要么借这次改名把 `WENYAN_PC_ROOT` 改成
基于脚本自身位置推导（`%~dp0..`），彻底去掉硬编码。

### 3.5 关联仓库与执行顺序

#### 涉及范围：名下 3 个 fork，只有 2 个与改名有关

| 仓库 | 自有提交 | 是否改名 | 说明 |
|---|---|---|---|
| `AfricChang/wenyan-pc` | 16 | ✅ 改名 | 本仓库，工作内容见 §3.1–§3.4 |
| `AfricChang/wenyan-ui` | 有 | ❌ **不改名** | 独立 fork（自带 `upstream = caol64/wenyan-ui`、自带 LICENSE/README），但需跟改 5 处，见下 |
| `AfricChang/wenyan` | **0** | ❌ 无需动 | 空壳 fork，见下 |

**`AfricChang/wenyan`（空壳 fork）**：`ahead_by: 0 / behind_by: 2`，一个自有提交都没有。
上游 `caol64/wenyan` 是 macOS App Store 的 Swift 版，与本项目 Tauri 这条线**无任何构建关系**
（`pushed_at` 停在 2026-04-01）。改名不需要碰它。
处置建议（独立决定，不阻塞改名）：既然零自有提交，**删掉最干净**，对 §1「避免与上游混淆」
和 §4 的商标风险都有帮助；保留亦无妨，但它对本项目没有任何贡献。

**明确排除**：`@wenyan-md/core` **不是 fork，名下无此仓库**。它是从 npm registry 安装的
上游发布包（本仓库 `package.json:50` 的 `^3.0.1`、wenyan-ui 的 `^3.0.2`，lock 中带 integrity sha512），
本 fork 未修改过它——mermaid / SVG 相关改动全部落在 wenyan-ui 与本仓库。

wenyan-ui 不改名的理由：§3.1 第 3 条列的 5 处构建配置绑的是**目录名**。
改仓库名只会让仓库名与 `path` 不一致，白添麻烦、零收益。

#### wenyan-ui 需要跟改的内容

| 位置 | 当前值 | 为什么要改 |
|---|---|---|
| `package.json:4` `author` | `Lei <caol64@gmail.com> (https://github.com/caol64)` | 与本仓库 `Cargo.toml:5` / `tauri.conf.json` copyright 属同一批署名义务，最容易漏 |
| `README.md:145` | 架构图中的 `wenyan-pc ← 桌面端（Tauri）` | **wenyan-ui 里唯一一处引用被改名仓库的地方**，改名后此行即失效 |
| `README.md:2` | logo 热链 `raw.githubusercontent.com/caol64/wenyan/main/Data/256-mac.png` | 上游素材热链：既是商标混淆点，也会随上游删文件而失效 |
| `README.md:152` | 赞助链接 `https://yuzhi.tech/sponsor` | 与本仓库 `.github/FUNDING.yml` 同一问题 |
| `README.md` 缺失项 | 完全没有 fork 出处说明 | 本仓库 README 有出处说明，wenyan-ui **没有**——Apache 2.0 §4(b) 的显著标记义务在该仓库尚未履行。建议加一行"本仓库基于 [caol64/wenyan-ui](https://github.com/caol64/wenyan-ui)" |

wenyan-ui 侧的好消息：无 `.github/FUNDING.yml`（不用删）、无自己的子模块（不用递归处理）、
`LICENSE` 是干净的 Apache 2.0 全文。

#### 执行顺序（避免多补一次子模块指针提交）

改动 wenyan-ui 会产生新 commit，而本仓库通过子模块指针钉住它，因此必须先子后父：

0. **前置不变量：子模块指针必须远端可达**（见下方专条）。
1. **先定下新仓库名**——`wenyan-ui/README.md:145` 要写它。
2. 改 wenyan-ui 上表 5 项 → commit → **push 到 `feature/mermaid-support` 分支**。
3. 回本仓库 `git add wenyan-ui` 提交新的子模块指针。
4. 再做 GitHub 平台改名（§3.1）+ 本仓库内容改动（§3.2–§3.4）。

反序执行的后果：本仓库改名提交完成后才发现子模块指针仍指向旧 commit，需要额外补一次提交。

#### ⚠️ 不变量：子模块指针必须在 wenyan-ui 远端可达

第 3 步提交指针前，wenyan-ui 的对应 commit **必须已经 push**。
只在本机存在的 commit 一旦被父仓库指针引用，任何人（包括 CI 和你换台机器）执行
`git clone --recursive` 或 `git submodule update --init` 都会失败——
父仓库看起来一切正常，断链只在别人 clone 时暴露。

检查命令（在 `wenyan-ui/` 内执行）：
```bash
git fetch origin
for c in $(cd .. && git rev-parse main:wenyan-ui HEAD:wenyan-ui); do
  git merge-base --is-ancestor $c origin/feature/mermaid-support \
    && echo "$c OK" || echo "$c UNREACHABLE"
done
```

**历史记录**：2026-09-01 曾出现过这个断链——wenyan-ui 有 3 个 commit
（`616e89c` PDF 导出、`21117cd` 明暗切换、`3efdb31` SVG 渲染）从未推送，
而父仓库 `main` 的指针指向 `21117cd`、`feat/svg-image-rendering` 的指针指向 `3efdb31`，
两者在远端都不存在，`clone --recursive` 必然失败。
已于同日 `git push origin feature/mermaid-support`（`74772c8..3efdb31`）修复并复验。
成因是父仓库那三个功能的提交推了、wenyan-ui 侧的对应提交没推——
**改名过程中每次动 wenyan-ui 都要重新过一遍上面的检查。**

### 3.6 有意保留的 `wenyan` 标识（不是遗漏）

品牌层已彻底改为稿匠，但**渲染内核这层的 `wenyan` 标识必须原样保留**。
这是 fork 消费上游 npm 包 `@wenyan-md/core` 的必然代价，不是可绕开的选择。

| 标识 | 位置 | 为什么不能改 |
|---|---|---|
| `id="wenyan"` | 父 `ScrollButtons.svelte:12`、`exportHandler.ts:146`、`utils.ts:65`；子 `ThemePreview.svelte:110` 等 | **决定性约束**。`core.js` 里每一个内置主题的 CSS 都是 `#wenyan h1{}`、`#wenyan p{}` 这样的选择器（`core.js:302`、`:596` 起整个主题库），且 `core.js:284` 有 `selector === "#wenyan"` 的硬判断。改了**所有主题样式立刻失效**，用户按官方教程写的自定义主题（格式就是 `#wenyan`）也一起失效 |
| `wenyan-theme-style`、`wenyan-hltheme-style`、`wenyan-macstyle-style` | 子 `ThemePreview.svelte` 写入，父 `exportHandler.ts:179-181` 读取 | 父子两仓库之间的接口契约，且与上面的 `#wenyan` 同源 |
| `wenyan-color-mode` | `src/app.html:8`、子 `app.html:9` | localStorage 键。改则用户已保存的明暗偏好丢失 |
| `wenyan-articles`、`wenyan-settings` | 子 `articleStore.svelte.ts:51`、`settingsStore.svelte.ts:148,152` | localStorage 键。改则用户文章列表与设置丢失 |
| `wenyan-db` | 子 `themeStore.svelte.ts:152` | IndexedDB 库名。改则用户自定义主题丢失 |
| `setGetWenyanElement` | 父 `setHooks.ts:22,60` | `@wenyan-md/core` 导出的 API 名，我们无权改 |
| `data-provider="WenYan"` | `core.js:1234` 内部写死 | core 内部行为 + 微信侧标记，我们改不了也不该改 |
| `@wenyan-md/core` 的 4 处 import | `imageUploadService.ts`、`wechatHandler.ts`(×2)、`setHooks.ts`、`package.json` | 上游 npm 发布包，非 fork，无对应仓库 |

已改名的功能性标识（确认无消费方后才动）：
`data-wenyan-mermaid` → `data-gaojiang-mermaid`（父 `imageProcessor.svelte.ts:13`、子 `utils/mermaid.ts:9`、测试断言各一处；
核实过 core 不认这个属性，全仓库也没有任何 `[data-wenyan-mermaid]` 选择器读它）；
`wenyan-export` → `gaojiang-export`（导出默认文件名，测试引用的是常量而非字面量）；
`wenyan-mermaid.cmd` → `gaojiang-mermaid.cmd`。

## 4. 注意事项 / 风险
- 改名不影响 git 历史与 LICENSE，无需改写历史。
- 旧链接由 GitHub 自动重定向，外部引用（书签、文档、CI）不会立即失效。
- GitHub Actions：**已核实无需调整**。`.github/workflows/release.yml` 中没有任何硬编码仓库名
  —— checkout 用的是隐式当前仓库（`actions/checkout@v6`，`submodules: recursive`），
  R2 上传全部走 secrets（`R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET`），
  而仓库级 secrets 在改名后保留。
- `src-tauri/tauri.conf.json` 中**没有** updater endpoint 指向 GitHub Release，
  因此不存在"改名后自动更新指向旧地址"的问题。
- 改名后如需发布 Release，注意 `tauri.conf.json` 中 `copyright` / `identifier`
  与 `Cargo.toml` 的 `authors` 已更新再构建。

## 5. 验收
- [x] GitHub 仓库名已变更且旧链接可访问（`wenyan-pc`→`gaojiang`、`wenyan-ui`→`gaojiang-ui`）
- [x] 本地 origin 指向新地址（父子两仓库，子仓库含 `mine` 远端）
- [x] tauri.conf.json 的 copyright / identifier 已更新（`com.africchang.gaojiang`）
- [x] src-tauri/Cargo.toml 的 authors 已更新（crate name 也改为 `gaojiang`，含 Cargo.lock）
- [x] README 的 fork 说明与链接正确
- [x] README clone 命令指向本仓库
- [x] README License / Stars / Issue / PR 链接已指向本仓库
- [x] `.github/FUNDING.yml` 已删除（本 fork 不代收上游赞助）
- [x] `.gitmodules` 已同步（`path`/`url`/`branch` 三项，5 处构建配置一并更新）
- [x] `tools/*.cmd` 已去掉硬编码绝对路径，改用 `%~dp0..` 相对推导
- [x] gaojiang-ui：`package.json` name+author、README 全面重写、图标与组件改名，已 commit + push
- [x] gaojiang-ui 的改动**先于**本仓库提交，本仓库子模块指针指向 `6ac9756`
- [x] 子模块指针在 gaojiang-ui 远端可达
- [ ] `AfricChang/wenyan` 空壳 fork 已决定处置方式（删除 / 保留）——**待定，不阻塞**
- [x] 构建验证：`svelte-check` 0 error、`web:build` 通过、`cargo check` 通过、27+12 单测通过
- [ ] `pnpm tauri:build` 产物署名正确 ——**未跑**（完整打包耗时长，改名本身已由 `cargo check` 覆盖）

## 6. 实际执行记录（2026-09-01）

按 §3.5 的先子后父顺序执行：

1. **分支**：父子两仓库各建 `rename/gaojiang`（父基于 `feat/svg-image-rendering` 的 `65b4259`）。
2. **子仓库**：包名、author、图标（`WenYan.svelte`→`Gaojiang.svelte`，字形 颜→稿，主色 `#1E90FF`→`#0F766E`）、
   组件导出、TitleBar 文字、README 全面重写 → `6ac9756` → push 到 `origin/rename/gaojiang`。
3. **平台改名**：`gh repo rename` 两次，随后父子两仓库 `git remote set-url`。
4. **父仓库**：目录 `wenyan-ui/`→`gaojiang-ui/`、`.gitmodules` 三项、5 处构建配置、
   17 处 import、组件引用、品牌层（productName/identifier/copyright/crate name/release 产物名）、
   README、FUNDING、tools 脚本。
5. **验证**：`pnpm install` 两处重装 → `svelte-check` → `web:build` → `cargo check` → 单测。

### 执行中踩到的两个坑

**坑 1：`git mv` 对子模块在 Windows 下失败。**
`git mv wenyan-ui gaojiang-ui` 报 `Permission denied`（重试仍失败），
但 PowerShell 的 `Rename-Item` 直接成功——说明目录并未被占用，是 `git mv` 自身对子模块的处理问题。
改名后需手工补 4 步 git 记账，缺任何一步子模块都会坏：
```bash
mv .git/modules/wenyan-ui .git/modules/gaojiang-ui        # 1. 内部 gitdir
echo 'gitdir: ../.git/modules/gaojiang-ui' > gaojiang-ui/.git   # 2. gitdir 指针
git config -f .git/modules/gaojiang-ui/config core.worktree ../../../gaojiang-ui  # 3. worktree 反向指针
git rm --cached wenyan-ui && git add gaojiang-ui .gitmodules     # 4. index（注意：.gitmodules 需先 staged，否则 git rm --cached 会被拒）
```

**坑 2：目录改名会让子模块的 `node_modules` 符号链接全部失效。**
pnpm 的链接记的是绝对路径，目录一改，子仓库 `pnpm exec` 直接 `MODULE_NOT_FOUND`，
父仓库 `svelte-check` 则报 2 个 `@codemirror/state` 类型冲突（同一包经两条路径解析成两个类型身份）。
**在父子两处都跑一遍 `pnpm install` 即可修复**（子仓库需 `CI=1` 跳过交互确认），修复后两边均 0 error。
这不是既存问题，是改名的直接后果，务必在验证阶段之前处理。
