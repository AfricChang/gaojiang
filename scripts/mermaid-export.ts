#!/usr/bin/env node
import { exportMermaidFromFile } from "../src/lib/headless/mermaidExport.ts";
import { getMermaidCliHelp, parseMermaidCliArgs } from "../src/lib/headless/mermaidCli.ts";

function formatError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

async function main() {
    const options = parseMermaidCliArgs(process.argv.slice(2));
    if (options.help) {
        console.log(getMermaidCliHelp());
        return;
    }

    const result = await exportMermaidFromFile({
        format: options.format,
        inputPath: options.inputPath!,
        outputDir: options.outputDir,
        selection: options.selection,
        selectedIndex: options.selectedIndex,
    });

    for (const writtenFile of result.writtenFiles) {
        console.log(`Wrote ${writtenFile}`);
    }

    if (result.failures.length > 0) {
        for (const failure of result.failures) {
            console.error(`Mermaid block ${failure.index} failed: ${failure.error}`);
        }
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(formatError(error));
    console.error("");
    console.error(getMermaidCliHelp());
    process.exitCode = 1;
});
