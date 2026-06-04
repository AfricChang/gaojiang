# PDF 导出功能审核报告

## 整体架构

PDF 导出流程：**前端克隆 DOM → 内联图片/光栅化 Mermaid SVG → 生成完整 HTML 写入临时文件 → Tauri 调用 bundled Node.js + Playwright 生成 A4 PDF**

涉及三个核心文件：

- `src/lib/services/exportHandler.ts` — 前端导出入口
- `scripts/pdf-export.ts` — Playwright PDF 生成脚本
- `src-tauri/src/main.rs` — Rust 端命令 & 运行时解析

---

## 需要关注的问题

### ~~1. 临时 HTML 文件未清理~~ — ✅ 已修复

`exportPdf()` 在 `tempDir` 写入 `wenyan-export-{timestamp}.html`。

**当前状态**：Rust 端已通过 `TempFileGuard` RAII 守卫（`main.rs` 第 133、182-196 行）在函数返回时自动删除临时文件，无论成功或失败都会执行 `Drop::drop` 中的 `std::fs::remove_file`。无需额外处理。

### ~~2. `waitForImages` 缺少超时机制~~ — ✅ 已修复

**当前状态**：
- 前端 `exportHandler.ts`（第 74-92 行）已添加 10 秒 `setTimeout` 兜底，并在 `load/error` 回调中正确 `clearTimeout`
- Playwright 端 `pdf-export.ts`（第 55 行）`waitForFunction` 设置了 `timeout: 120_000`（120 秒）全局超时

两处均有超时保护，不会无限挂起。

### ~~3. `waitForImages` 中 `map` 返回值类型不一致~~ — ✅ 已修复

**当前状态**：`pdf-export.ts`（第 43-44 行）`image.complete` 为 true 时已统一返回 `Promise.resolve(true)`，类型一致。

---

## 设计层面的建议

### ~~4. `writeTextFile` 缺少 Tauri ACL 权限~~ — ✅ 已修复

**问题表现**：界面导出 PDF 时报错：`Command plugin:fs|write_text_file not allowed by ACL`。

**当前状态**：`src-tauri/capabilities/migrated.json` 已添加 `fs:allow-write-text-file`，前端 `writeTextFile` 写入临时 HTML 的权限已放开。重新编译后的 release 产物可使用该权限。

### ~~5. Node.js 回退到系统 PATH 存在隐患~~ — ✅ 已处理

**当前状态**：`resolve_pdf_runtime` 在使用 `.ts` 脚本回退时，已调用 `validate_node_strip_types_support`（`main.rs` 第 260-287 行）校验 Node 版本是否 >= 22.6，不满足时返回包含版本号和替代方案的清晰错误信息。此问题已被妥善处理。

### 6. PDF 导出期间缺少用户进度反馈（仍有效）

整个 Playwright 启动 → 页面渲染 → PDF 生成过程可能耗时较长（尤其是大文档），用户只看到 `isLoading` 状态。可以考虑增加阶段性提示（如"正在启动浏览器…"、"正在生成 PDF…"）。

**实现建议**：可通过 Tauri 的 `emit` 事件机制从 Rust 端向前端发送阶段信息，前端在 `exportPdf` 中监听事件并更新提示文案。

### ~~7. CSS 边距与 Playwright 边距重复定义~~ — ✅ 不存在此问题

**当前状态**：`pdf-export.ts` 的 `page.pdf()` 调用（第 87-92 行）**未设置 `margin` 参数**，仅依赖 CSS `@page { margin: 16mm 14mm }` 配合 `preferCSSPageSize: true`。不存在重复定义。

---

## 新增发现

### 8. Playwright `waitForImages` 内单张图片无超时（低优先级）

`pdf-export.ts` 第 37-57 行，虽然 `waitForFunction` 有 120 秒全局超时，但内部每张图片的 `load/error` Promise 没有单独超时。如果某张图片长时间未响应，会消耗全部 120 秒后才失败。

**建议**：为每张图片添加类似前端的超时机制：

```typescript
return new Promise((resolve) => {
    const timer = setTimeout(resolve, 10_000);
    image.addEventListener("load", () => { clearTimeout(timer); resolve(true); }, { once: true });
    image.addEventListener("error", () => { clearTimeout(timer); resolve(true); }, { once: true });
});
```

### 9. `rasterizeMermaidSvgs` 中 SVG 替换后未显式等待（无需修复）

**当前状态**：`prepareExportClone` 在调用 `rasterizeMermaidSvgs` 后会再调用 `waitForImages`（第 154 行）兜底，替换后的 `<img>` 会被正确等待。无需额外处理。

### 10. `exportImage` 中 Base64 解码方式可优化（建议）

`exportHandler.ts` 第 258-264 行使用 `atob` + 逐字节循环构造 `Uint8Array`。对于大图片性能较差，建议改用：

```typescript
const bytes = Uint8Array.from(atob(base64Part), (c) => c.charCodeAt(0));
```

---

## 代码质量良好的部分

- **临时文件清理**完善：`TempFileGuard` RAII 模式确保无论成功/失败都会删除临时 HTML
- **图片内联逻辑**完善：区分了网络图片/本地图片/data URI，分别处理
- **Mermaid SVG 光栅化**考虑了 xmlns 命名空间、尺寸边界保护
- **浏览器回退策略**合理：优先 Edge，其次 Chrome，给出清晰的错误提示
- **Rust 端运行时解析**三级回退（资源目录 → dist-cli → 源码）设计灵活
- **Node.js 版本校验**：回退到系统 Node 时会校验 >= 22.6，错误信息包含版本号和替代方案
- **错误处理**完整：前后端均有 try/catch/finally，DOM 克隆节点在 finally 中清理
- **Windows 特殊处理**：`CREATE_NO_WINDOW` 标志避免弹出控制台窗口
- **图片等待超时**：前端 `waitForImages` 已有 10 秒超时兜底

---

## 总结

| 严重程度 | 问题                                        | 状态                 |
| -------- | ------------------------------------------- | -------------------- |
| ~~中~~   | ~~临时 HTML 未清理~~                        | ✅ `TempFileGuard` 已修复 |
| ~~低~~   | ~~`waitForImages` 无超时~~                  | ✅ 前端 10s，Playwright 全局 120s |
| ~~低~~   | ~~`map` 返回值类型不一致~~                  | ✅ 已统一为 Promise      |
| ~~低~~   | ~~系统 Node 回退无版本校验~~                | ✅ 已有版本校验          |
| ~~中~~   | ~~`writeTextFile` 缺少 ACL 权限~~           | ✅ 已添加 `fs:allow-write-text-file` |
| ~~建议~~ | ~~边距重复定义~~                            | ✅ 实际不存在此问题      |
| 低       | Playwright 内单张图片无超时                 | 全局 120s 兜底，可继续优化 |
| ~~低~~   | ~~SVG 光栅化后未显式等待~~                  | ✅ 已被后续 waitForImages 兜底 |
| 建议     | Base64 解码可优化                           | 可用 `Uint8Array.from` |
| 建议     | 缺少进度反馈                                | 建议增加阶段提示       |

整体实现质量很好。原先审核中发现的大部分问题已在代码中修复，核心的导出流程、错误处理、资源清理和运行时解析都设计得比较周全。剩余建议项可作为后续优化。
