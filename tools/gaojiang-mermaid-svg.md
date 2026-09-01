# gaojiang-mermaid.cmd 用法

这个脚本用于在不启动稿匠图形界面的情况下，把 Markdown 或 `.mmd` 文件里的 Mermaid 流程图导出为 SVG 或 PNG。

脚本位置：

```powershell
.\gaojiang-mermaid.cmd
```

## 快速使用

在 PowerShell 或 CMD 中运行：

```powershell
.\gaojiang-mermaid.cmd "建筑面宽.md"
```

默认会把 SVG 输出到输入文件所在目录。

## 导出 PNG

```powershell
.\gaojiang-mermaid.cmd "建筑面宽.md" --format png
```

导出 PNG 并指定输出目录：

```powershell
.\gaojiang-mermaid.cmd "建筑面宽.md" --format png --out-dir output\mermaid
```

## 指定输出目录

```powershell
.\gaojiang-mermaid.cmd "建筑面宽.md" --out-dir output\mermaid
```

如果输出目录不存在，会自动创建。

## 只导出第一个 Mermaid 图

```powershell
.\gaojiang-mermaid.cmd "建筑面宽.md" --first
```

## 导出指定 Mermaid 图

`--index` 从 1 开始计数：

```powershell
.\gaojiang-mermaid.cmd "建筑面宽.md" --index 2
```

## 导出所有 Mermaid 图

`.md` 文件默认就是导出所有 Mermaid 图，也可以显式写：

```powershell
.\gaojiang-mermaid.cmd "建筑面宽.md" --all
```

## 直接渲染 .mmd 文件

```powershell
.\gaojiang-mermaid.cmd "diagram.mmd" --out-dir output
```

`.mmd` 会被当作单个 Mermaid 图处理。

## 输出文件命名

单个图：

```text
输入文件名.svg
输入文件名.png
```

例如：

```text
建筑面宽.svg
建筑面宽.png
```

多个图：

```text
输入文件名.mermaid-01.svg
输入文件名.mermaid-02.svg
输入文件名.mermaid-01.png
输入文件名.mermaid-02.png
```

## 拷贝到其他地方使用

可以把 `gaojiang-mermaid.cmd` 拷贝到桌面或任意目录使用。

旧的 `gaojiang-mermaid-svg.cmd` 仍然可用，也支持 `--format png`。

注意：这个脚本内部固定指向当前机器上的项目目录：

```text
E:\github\wenyan-pc
```

所以它适合在这台机器上拷贝使用；如果项目目录移动了，需要修改脚本里的 `WENYAN_PC_ROOT`。

## 依赖说明

当前版本依赖这台机器上的 Node.js、项目依赖和系统 Edge / Chrome。

如果看到下面提示，属于正常情况，只要 SVG 正常生成就可以忽略：

```text
Playwright bundled Chromium is unavailable; falling back to a system browser.
```

如果导出失败并提示找不到浏览器，可以在项目目录执行：

```powershell
pnpm exec playwright install chromium
```

## 查看帮助

```powershell
.\gaojiang-mermaid.cmd --help
```
