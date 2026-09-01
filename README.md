<div align="center">
    <img alt = "logo" src="data/256-mac.png" width="128" />
</div>

# 稿匠

[![Download](https://img.shields.io/badge/download-latest-brightgreen?logo=github&logoColor=white)](https://github.com/AfricChang/gaojiang/releases)
[![License](https://img.shields.io/github/license/AfricChang/gaojiang)](LICENSE)
[![Stars](https://img.shields.io/github/stars/AfricChang/gaojiang?style=social)](https://github.com/AfricChang/gaojiang)

## 本仓库说明

**稿匠**是 [caol64/wenyan-pc](https://github.com/caol64/wenyan-pc)（文颜，Apache License 2.0）的 fork，
独立命名以明确区分身份，**与上游文颜项目无官方关联**，请勿将本项目的问题反馈至上游。

本 fork 专注 Windows 桌面端体验，在上游能力基础上加入：

- 编辑 / 预览 / 双视图切换，支持编辑独占与预览独占模式。
- 明暗主题切换，偏好持久化。
- Mermaid 流程图渲染修正，尽量避免中文文字裁切或显示不全。
- 内置 Mermaid 命令行导出工具，可从 Markdown / Mermaid 文件导出 SVG 或 PNG。
- PDF 导出、SVG 图片渲染。
- 多进程多开，各窗口编辑不同文档互不干扰。
- 导出文件名按文档名 / 标题自动推导。

下面的项目介绍保留上游文颜的主体说明，渲染与发布能力来自上游的
[`@wenyan-md/core`](https://github.com/caol64/wenyan-core)。

## 简介

**[文颜（Wenyan）](https://wenyan.yuzhi.tech)** 是一款多平台 Markdown 排版与发布工具，支持将 Markdown 一键转换并发布至：

-   微信公众号
-   知乎
-   今日头条
-   以及其它内容平台（持续扩展中）

文颜的目标是：**让写作者专注内容，而不是排版和平台适配**。

## 文颜的不同版本

文颜目前提供多种形态，覆盖不同使用场景：

* [macOS App Store 版](https://github.com/caol64/wenyan) - MAC 桌面应用
* [跨平台版本](https://github.com/caol64/wenyan-pc) - 上游 Tauri 桌面端（**本项目 fork 自此**）
* [CLI 版本](https://github.com/caol64/wenyan-cli) - 命令行 / CI 自动化发布
* [MCP 版本](https://github.com/caol64/wenyan-mcp) - AI 自动发文
* [UI 库](https://github.com/caol64/wenyan-ui) - 桌面应用和 Web App 共用的 UI 层封装
* [核心库](https://github.com/caol64/wenyan-core) - 渲染、排版等核心能力

本项目使用自己的 UI 层 fork [AfricChang/gaojiang-ui](https://github.com/AfricChang/gaojiang-ui)（`@gaojiang/ui`），
核心库仍直接使用上游发布的 npm 包 `@wenyan-md/core`。

## 功能特性

本项目的核心功能是将编辑好的`markdown`文章转换成适配各个发布平台的格式，通过一键复制，可以直接粘贴到平台的文本编辑器，无需再做额外调整。

-   使用内置主题对 Markdown 内容排版
-   自动处理并上传本地图片，[阅读文档](https://yuzhi.tech/docs/wenyan/upload)
-   支持数学公式（MathJax）
-   支持发布到多平台：
    -   公众号
    -   知乎
    -   今日头条
    -   掘金、CSDN 等
    -   Medium
-   支持代码高亮
-   支持链接转脚注
-   支持识别`front matter`语法
-   自定义主题
    -   支持自定义样式
    -   支持导入现成的主题
    -   [使用教程](https://babyno.top/posts/2024/11/wenyan-supports-customized-themes/)
    -   [功能讨论](https://github.com/caol64/wenyan/discussions/9)
    -   [主题分享](https://github.com/caol64/wenyan/discussions/13)
-   支持导出长图
-   支持编辑视图独占、预览视图独占和双视图模式
-   支持无界面导出 Mermaid 图为 SVG / PNG

## 主题效果预览

👉 [内置主题预览](https://yuzhi.tech/docs/wenyan/theme)

## 应用截图

![](data/1.jpg)

## 更多功能介绍

排版与发布能力的详细说明见上游文档：[https://wenyan.yuzhi.tech/](https://wenyan.yuzhi.tech/)

## 下载安装包

**稿匠**（本项目）：[GitHub Releases](https://github.com/AfricChang/gaojiang/releases)

上游**文颜**：[https://yuzhi.tech/docs/wenyan/download](https://yuzhi.tech/docs/wenyan/download)

## 从源码运行

本项目使用`tauri`进行开发，需要事先已经安装`rust`和`node`环境。

**克隆仓库**

```sh
git clone --recursive https://github.com/AfricChang/gaojiang
```

**安装依赖**

```sh
pnpm install
```

**同步ui组件**

```sh
pnpm ui:sync
```

**运行**

```sh
pnpm tauri:dev
```

**构建 release**

```sh
pnpm tauri build
```

release 构建会自动执行 `pnpm cli:stage`，把 Mermaid CLI runtime 打包进 Tauri resources。

## Mermaid 命令行导出

本 fork 提供 Windows 版 `gaojiang-mermaid.cmd`，用于在不启动图形界面的情况下导出 Mermaid 图。

源码开发时可以直接使用：

```powershell
pnpm mermaid:export -- "article.md" --format svg
pnpm mermaid:export -- "article.md" --format png --out-dir output
pnpm mermaid:export -- "diagram.mmd" --format svg
```

安装 / release 产物中，命令位于应用 `resources` 目录，不会写入 `PATH`：

```powershell
.\gaojiang-mermaid.cmd "article.md" --format svg
.\gaojiang-mermaid.cmd "article.md" --format png --index 2
```

说明：

- 支持 `.md`、`.markdown`、`.mmd` 输入。
- Markdown 只提取 fenced code block 中的 `mermaid`，不会渲染整篇 Markdown。
- 运行时依赖系统 Microsoft Edge 或 Google Chrome，不打包 Chromium。
- 详细说明见 [docs/mermaid-cli.md](docs/mermaid-cli.md)。

## 如何贡献

- 通过 [Issue](https://github.com/AfricChang/gaojiang/issues) 报告**bug**或进行咨询。
- 提交 [Pull Request](https://github.com/AfricChang/gaojiang/pulls)。
- 分享 [自定义主题](https://github.com/caol64/wenyan/discussions/13)。
- 推荐美观的 `Typora` 主题。

## 上游致谢

本项目基于 [caol64/wenyan-pc](https://github.com/caol64/wenyan-pc)，感谢上游作者和社区贡献者。

## License

Apache License Version 2.0
