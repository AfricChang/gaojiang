import fs from "node:fs/promises";
import path from "node:path";
import type { MermaidRenderFormat, MermaidRenderSuccess } from "./mermaidRenderer.ts";

export interface WriteRenderedDiagramsOptions {
    format: MermaidRenderFormat;
    inputPath: string;
    outputDir?: string;
    selectedCount: number;
}

function getOutputFileName(inputPath: string, selectedCount: number, blockIndex: number, format: MermaidRenderFormat): string {
    const parsed = path.parse(inputPath);
    const extension = `.${format}`;

    if (selectedCount === 1) {
        return `${parsed.name}${extension}`;
    }

    return `${parsed.name}.mermaid-${String(blockIndex).padStart(2, "0")}${extension}`;
}

export async function writeRenderedDiagrams(
    diagrams: MermaidRenderSuccess[],
    options: WriteRenderedDiagramsOptions
): Promise<string[]> {
    const outputDir = options.outputDir ? path.resolve(options.outputDir) : path.dirname(path.resolve(options.inputPath));
    await fs.mkdir(outputDir, { recursive: true });

    const writtenFiles: string[] = [];

    for (const diagram of diagrams) {
        const fileName = getOutputFileName(options.inputPath, options.selectedCount, diagram.index, options.format);
        const filePath = path.join(outputDir, fileName);
        if (typeof diagram.content === "string") {
            await fs.writeFile(filePath, diagram.content, "utf8");
        } else {
            await fs.writeFile(filePath, diagram.content);
        }
        writtenFiles.push(filePath);
    }

    return writtenFiles;
}
