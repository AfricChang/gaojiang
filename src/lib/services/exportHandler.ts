import { domToPng } from "modern-screenshot";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { save } from "@tauri-apps/plugin-dialog";
import { globalState, wenyanRenderer } from "@wenyan-md/ui";
import { join, tempDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { downloadImageToBase64, getPathType, localPathToBase64, resolveRelativePath } from "$lib/utils";
import { getLastArticleRelativePath } from "$lib/stores/sqliteArticleStore";
import { appState } from "$lib/appState.svelte";
import { pickExportBaseName } from "./exportFileName";

/**
 * 读取当前状态，交给纯函数定出导出文件名的基名。
 * 规则（文档名 -> 标题 -> 默认名）与各级清理逻辑见 exportFileName.ts。
 */
function resolveExportBaseName(): string {
    const { title, body } = wenyanRenderer.frontMatterResult;
    return pickExportBaseName({
        documentName: appState.currentDocumentName,
        frontMatterTitle: title,
        markdown: body || globalState.getMarkdownText(),
    });
}

async function rasterizeMermaidSvgs(root: HTMLElement) {
    const svgElements = root.querySelectorAll<SVGSVGElement>('pre[data-mermaid-processed="true"] svg');
    if (svgElements.length === 0) return;

    const xmlSerializer = new XMLSerializer();

    await Promise.all(
        Array.from(svgElements).map(async (svgElement) => {
            const rect = svgElement.getBoundingClientRect();
            const width = Math.max(1, Math.ceil(rect.width));
            const height = Math.max(1, Math.ceil(rect.height));

            if (width <= 1 || height <= 1) return;

            let svgText = xmlSerializer.serializeToString(svgElement);
            if (!svgText.includes("xmlns=")) {
                svgText = svgText.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
            }
            if (!svgText.includes("xmlns:xlink=")) {
                svgText = svgText.replace("<svg", '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
            }

            const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
            const objectUrl = URL.createObjectURL(blob);

            try {
                const image = await new Promise<HTMLImageElement>((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => resolve(img);
                    img.onerror = () => reject(new Error("Failed to load mermaid svg"));
                    img.src = objectUrl;
                });

                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const context = canvas.getContext("2d");
                if (!context) return;

                context.drawImage(image, 0, 0, width, height);

                const pngDataUrl = canvas.toDataURL("image/png");
                const imgElement = document.createElement("img");
                imgElement.src = pngDataUrl;
                imgElement.width = width;
                imgElement.height = height;
                imgElement.style.display = "block";
                imgElement.style.width = `${width}px`;
                imgElement.style.height = `${height}px`;

                svgElement.replaceWith(imgElement);
            } catch (error) {
                console.error("Mermaid rasterize error:", error);
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
        })
    );
}

function getStyleText(id: string) {
    return document.getElementById(id)?.textContent ?? "";
}

async function waitForImages(root: HTMLElement) {
    const images = Array.from(root.querySelectorAll("img"));
    await Promise.all(
        images.map((image) => {
            if (image.complete) {
                return Promise.resolve();
            }
            return new Promise<void>((resolve) => {
                const timer = window.setTimeout(() => resolve(), 10_000);
                const done = () => {
                    window.clearTimeout(timer);
                    resolve();
                };
                image.onload = done;
                image.onerror = done;
            });
        })
    );
}

async function inlineImagesForExport(root: HTMLElement) {
    const images = Array.from(root.querySelectorAll("img"));
    if (images.length === 0) return;

    const relativePath = (await getLastArticleRelativePath()) || undefined;

    await Promise.all(
        images.map(async (img) => {
            const currentSrc = img.getAttribute("src") || img.src;
            if (!currentSrc || currentSrc.startsWith("data:")) {
                return;
            }

            const originalSrc = img.getAttribute("data-src") || currentSrc;
            if (originalSrc.startsWith("data:")) {
                img.src = originalSrc;
                return;
            }

            try {
                if ((await getPathType(originalSrc)) === "network") {
                    img.src = await downloadImageToBase64(originalSrc);
                    return;
                }

                const resolvedSrc = await resolveRelativePath(originalSrc, relativePath);
                img.src = await localPathToBase64(resolvedSrc);
            } catch (error) {
                console.error("Image inline failed:", originalSrc, error);
            }
        })
    );

    await waitForImages(root);
}

async function prepareExportClone(width = "860px") {
    const element = document.getElementById("wenyan");
    if (!element) {
        throw new Error("Wenyan element not found");
    }

    const host = document.createElement("div");
    const clonedWenyan = element.cloneNode(true) as HTMLElement;

    Object.assign(host.style, {
        position: "fixed",
        top: "0",
        left: "-10000px",
        width,
        backgroundColor: "#ffffff",
        pointerEvents: "none",
    });

    host.appendChild(clonedWenyan);
    document.body.appendChild(host);

    try {
        await inlineImagesForExport(clonedWenyan);
        await rasterizeMermaidSvgs(clonedWenyan);
        await waitForImages(clonedWenyan);
        await document.fonts?.ready;
        return { host, clonedWenyan };
    } catch (error) {
        document.body.removeChild(host);
        throw error;
    }
}

function buildPdfHtml(wenyanElement: HTMLElement) {
    const themeCss = getStyleText("wenyan-theme-style");
    const hlThemeCss = getStyleText("wenyan-hltheme-style");
    const macStyleCss = getStyleText("wenyan-macstyle-style");
    const exportHtml = wenyanElement.outerHTML;

    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
${themeCss}
${hlThemeCss}
${macStyleCss}
@page {
    size: A4;
    margin: 16mm 14mm;
}
html,
body {
    margin: 0;
    padding: 0;
    background: #ffffff;
}
body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
}
#wenyan {
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
}
#wenyan img,
#wenyan svg {
    max-width: 100%;
    height: auto;
}
#wenyan img,
#wenyan pre,
#wenyan blockquote,
#wenyan table,
#wenyan figure {
    break-inside: avoid;
    page-break-inside: avoid;
}
#wenyan h1,
#wenyan h2,
#wenyan h3,
#wenyan h4 {
    break-after: avoid;
    page-break-after: avoid;
}
#wenyan p,
#wenyan li {
    orphans: 3;
    widows: 3;
}
</style>
</head>
<body>
${exportHtml}
</body>
</html>`;
}

export async function exportImage() {
    let bgColor = window.getComputedStyle(document.body).backgroundColor;
    // 如果获取到的是透明色 (rgba(0, 0, 0, 0)) 或者 transparent，设置为白色
    if (bgColor === "rgba(0, 0, 0, 0)" || bgColor === "transparent") {
        bgColor = "#ffffff";
    }

    let host: HTMLElement | null = null;

    try {
        globalState.isLoading = true;
        const prepared = await prepareExportClone("420px");
        host = prepared.host;

        // 5. 生成图片 (此时 clonedWenyan 确定在 DOM 中)
        const dataUrl = await domToPng(prepared.clonedWenyan, {
            scale: 2,
            backgroundColor: bgColor,
            fetch: { requestInit: { mode: "cors" } },
        });

        // 6. 保存逻辑
        const filePath = await save({
            title: "保存导出的图片",
            filters: [{ name: "Image", extensions: ["png"] }],
            defaultPath: `${resolveExportBaseName()}.png`,
        });

        if (filePath) {
            const base64Part = dataUrl.split(",")[1];
            const binaryString = atob(base64Part);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            await writeFile(filePath, bytes);
        }
    } catch (error) {
        console.error("保存失败:", error);
        globalState.setAlertMessage({
            type: "error",
            message: `保存失败: ${error instanceof Error ? error.message : String(error)}`,
        });
    } finally {
        if (host?.parentNode) {
            document.body.removeChild(host);
        }
        globalState.isLoading = false;
    }
}

export async function exportPdf() {
    const filePath = await save({
        title: "保存导出的 PDF",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
        defaultPath: `${resolveExportBaseName()}.pdf`,
    });

    if (!filePath) {
        return;
    }

    let host: HTMLElement | null = null;

    try {
        globalState.isLoading = true;
        const prepared = await prepareExportClone("860px");
        host = prepared.host;

        const html = buildPdfHtml(prepared.clonedWenyan);
        const htmlPath = await join(await tempDir(), `wenyan-export-${Date.now()}.html`);
        await writeTextFile(htmlPath, html);

        await invoke("export_pdf_with_browser", {
            htmlPath,
            outputPath: filePath,
        });

        globalState.setAlertMessage({
            type: "success",
            message: "PDF 导出完成。",
        });
    } catch (error) {
        console.error("PDF 保存失败:", error);
        globalState.setAlertMessage({
            type: "error",
            message: `PDF 保存失败: ${error instanceof Error ? error.message : String(error)}`,
        });
    } finally {
        if (host?.parentNode) {
            document.body.removeChild(host);
        }
        globalState.isLoading = false;
    }
}
