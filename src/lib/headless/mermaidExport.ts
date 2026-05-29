import fs from "node:fs/promises";
import path from "node:path";
import { extractMermaidBlocks, selectMermaidBlocks, type MermaidBlock } from "./mermaidExtractor.ts";
import { renderMermaidBlocks, type MermaidRenderFailure, type MermaidRenderFormat } from "./mermaidRenderer.ts";
import { writeRenderedDiagrams } from "./mermaidWriter.ts";

export interface MermaidExportOptions {
    format: MermaidRenderFormat;
    inputPath: string;
    outputDir?: string;
    selection: "all" | "first" | "index";
    selectedIndex?: number;
}

export interface MermaidExportResult {
    failures: MermaidRenderFailure[];
    selectedCount: number;
    sourceCount: number;
    writtenFiles: string[];
}

function getSupportedInputKind(inputPath: string): "markdown" | "mermaid" {
    const extension = path.extname(inputPath).toLowerCase();
    if (extension === ".md" || extension === ".markdown") {
        return "markdown";
    }
    if (extension === ".mmd") {
        return "mermaid";
    }
    throw new Error(`Unsupported input file type: ${extension || "<none>"}. Use .md, .markdown, or .mmd.`);
}

async function loadBlocks(inputPath: string): Promise<MermaidBlock[]> {
    const sourceKind = getSupportedInputKind(inputPath);
    const content = await fs.readFile(inputPath, "utf8");

    if (sourceKind === "mermaid") {
        return [{ index: 1, code: content }];
    }

    const blocks = extractMermaidBlocks(content);
    if (blocks.length === 0) {
        throw new Error(`No Mermaid code blocks found in ${inputPath}.`);
    }
    return blocks;
}

function resolveSelection(inputPath: string, blocks: MermaidBlock[], selection: MermaidExportOptions["selection"], selectedIndex?: number) {
    const sourceKind = getSupportedInputKind(inputPath);
    if (sourceKind === "mermaid") {
        return blocks;
    }
    return selectMermaidBlocks(blocks, selection, selectedIndex);
}

export async function exportMermaidFromFile(options: MermaidExportOptions): Promise<MermaidExportResult> {
    const absoluteInputPath = path.resolve(options.inputPath);
    const sourceBlocks = await loadBlocks(absoluteInputPath);
    const selectedBlocks = resolveSelection(absoluteInputPath, sourceBlocks, options.selection, options.selectedIndex);

    if (selectedBlocks.length === 0) {
        throw new Error(`No Mermaid diagrams selected from ${absoluteInputPath}.`);
    }

    const renderResult = await renderMermaidBlocks(selectedBlocks, { format: options.format });
    const writtenFiles = await writeRenderedDiagrams(renderResult.successes, {
        format: options.format,
        inputPath: absoluteInputPath,
        outputDir: options.outputDir,
        selectedCount: selectedBlocks.length,
    });

    return {
        failures: renderResult.failures,
        selectedCount: selectedBlocks.length,
        sourceCount: sourceBlocks.length,
        writtenFiles,
    };
}
