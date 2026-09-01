import fs from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";
import type { MermaidBlock } from "./mermaidExtractor.ts";

export type MermaidRenderFormat = "svg" | "png";

export interface MermaidRenderFailure {
    index: number;
    error: string;
}

export interface MermaidRenderSuccess {
    index: number;
    content: string | Uint8Array;
}

export interface MermaidRenderBatchResult {
    failures: MermaidRenderFailure[];
    successes: MermaidRenderSuccess[];
}

export interface MermaidRenderOptions {
    format: MermaidRenderFormat;
}

const mermaidRuntimePath = fileURLToPath(new URL("../../../node_modules/mermaid/dist/mermaid.min.js", import.meta.url));
const captureRootId = "gaojiang-mermaid-capture";

function formatError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

function normalizeSvg(svg: string): string {
    let normalized = svg.trim();
    if (!normalized.startsWith("<svg")) {
        return normalized;
    }
    if (!normalized.includes("xmlns=")) {
        normalized = normalized.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    if (!normalized.includes("xmlns:xlink=")) {
        normalized = normalized.replace("<svg", '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
    }
    return normalized;
}

async function launchHeadlessBrowser(): Promise<Browser> {
    const failures: string[] = [];
    const systemBrowsers = [
        { channel: "msedge", label: "Microsoft Edge" },
        { channel: "chrome", label: "Google Chrome" },
    ];

    for (const browser of systemBrowsers) {
        try {
            return await chromium.launch({ channel: browser.channel, headless: true });
        } catch (error) {
            failures.push(`${browser.label}: ${formatError(error).split("\n", 1)[0]}`);
        }
    }

    throw new Error(
        [
            "Failed to launch a headless browser for Mermaid export.",
            "Install Microsoft Edge or Google Chrome, then run the command again.",
            ...failures,
        ].join("\n")
    );
}

export async function renderMermaidBlocks(blocks: MermaidBlock[], options: MermaidRenderOptions): Promise<MermaidRenderBatchResult> {
    if (blocks.length === 0) {
        return { failures: [], successes: [] };
    }

    await fs.access(mermaidRuntimePath);

    const browser = await launchHeadlessBrowser();
    const page = await browser.newPage({
        deviceScaleFactor: 2,
        viewport: { width: 1600, height: 900 },
    });

    try {
        await page.setContent("<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>");
        await page.addScriptTag({ path: mermaidRuntimePath, type: "text/javascript" });
        await page.waitForFunction(() => typeof (window as { mermaid?: unknown }).mermaid !== "undefined");

        await page.evaluate(() => {
            const mermaid = (window as unknown as { mermaid: { initialize: (options: Record<string, unknown>) => void } }).mermaid;
            mermaid.initialize({
                startOnLoad: false,
                theme: "default",
                securityLevel: "loose",
            });
        });

        const successes: MermaidRenderSuccess[] = [];
        const failures: MermaidRenderFailure[] = [];

        for (const block of blocks) {
            try {
                const { svg } = await page.evaluate(async ({ captureRootId, code, index }) => {
                    const mermaid = (window as unknown as {
                        mermaid: { render: (id: string, graphDefinition: string) => Promise<{ svg: string }> };
                    }).mermaid;
                    const { svg } = await mermaid.render(`gaojiang-mermaid-${index}`, code.trim());
                    const wrapper = document.createElement("div");
                    wrapper.innerHTML = svg;

                    const svgElement = wrapper.querySelector("svg");
                    if (!svgElement) {
                        throw new Error("Mermaid renderer did not return an SVG element.");
                    }

                    svgElement.setAttribute("data-gaojiang-mermaid", "true");
                    const labelElements = svgElement.querySelectorAll("foreignObject p, foreignObject div, foreignObject span");
                    for (const element of labelElements) {
                        if (!(element instanceof HTMLElement)) {
                            continue;
                        }
                        element.style.setProperty("margin", "0", "important");
                        element.style.setProperty("letter-spacing", "normal", "important");
                        element.style.setProperty("word-spacing", "normal", "important");
                        element.style.setProperty("text-align", "center", "important");
                        element.style.setProperty("text-indent", "0", "important");
                        element.style.setProperty("line-height", "1.5", "important");
                    }

                    const serializedSvg = new XMLSerializer().serializeToString(svgElement);
                    const captureSvg = svgElement.cloneNode(true) as SVGSVGElement;
                    const viewBoxParts = captureSvg
                        .getAttribute("viewBox")
                        ?.trim()
                        .split(/\s+/)
                        .map((part) => Number.parseFloat(part));
                    const rect = svgElement.getBoundingClientRect();
                    const width = Math.max(1, Math.ceil(viewBoxParts?.[2] || rect.width || 800));
                    const height = Math.max(1, Math.ceil(viewBoxParts?.[3] || rect.height || 600));

                    document.body.style.margin = "0";
                    document.body.style.background = "#ffffff";

                    let captureRoot = document.getElementById(captureRootId);
                    if (!captureRoot) {
                        captureRoot = document.createElement("div");
                        captureRoot.id = captureRootId;
                        document.body.appendChild(captureRoot);
                    }

                    Object.assign(captureRoot.style, {
                        background: "#ffffff",
                        display: "inline-block",
                        height: `${height}px`,
                        overflow: "hidden",
                        padding: "0",
                        width: `${width}px`,
                    });

                    captureSvg.setAttribute("width", String(width));
                    captureSvg.setAttribute("height", String(height));
                    captureSvg.style.width = `${width}px`;
                    captureSvg.style.height = `${height}px`;
                    captureSvg.style.maxWidth = "none";
                    captureSvg.style.display = "block";
                    captureRoot.replaceChildren(captureSvg);

                    return { svg: serializedSvg };
                }, { ...block, captureRootId });

                let content: MermaidRenderSuccess["content"] = normalizeSvg(svg);
                if (options.format === "png") {
                    await page.evaluate(() => document.fonts?.ready);
                    content = await page.locator(`#${captureRootId}`).screenshot({ type: "png" });
                }

                successes.push({ index: block.index, content });
            } catch (error) {
                failures.push({ index: block.index, error: formatError(error) });
            }
        }

        return { failures, successes };
    } catch (error) {
        throw new Error(`Failed to render Mermaid diagrams in headless Chromium: ${formatError(error)}`);
    } finally {
        await page.close();
        await browser.close();
    }
}

export function getMermaidRuntimeUrl(): string {
    return pathToFileURL(mermaidRuntimePath).href;
}
