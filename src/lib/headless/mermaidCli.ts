import type { MermaidRenderFormat } from "./mermaidRenderer.ts";

export interface MermaidCliOptions {
    format: MermaidRenderFormat;
    help: boolean;
    inputPath?: string;
    outputDir?: string;
    selectedIndex?: number;
    selection: "all" | "first" | "index";
}

const HELP_TEXT = `Usage:
  gaojiang-mermaid <input> [--out-dir <dir>] [--all | --first | --index <n>] [--format svg|png]

Options:
  --out-dir <dir>  Output directory. Defaults to the input file's directory.
  --all            Export every Mermaid block from Markdown input.
  --first          Export only the first Mermaid block from Markdown input.
  --index <n>      Export one Mermaid block by its 1-based index.
  --format <fmt>   Output format: svg or png. Defaults to svg.
  -h, --help       Show this help message.
`;

export function getMermaidCliHelp(): string {
    return HELP_TEXT;
}

export function parseMermaidCliArgs(argv: string[]): MermaidCliOptions {
    const args = [...argv];
    const options: MermaidCliOptions = {
        format: "svg",
        help: false,
        selection: "all",
    };

    const positionals: string[] = [];
    let selectionWasSet = false;

    while (args.length > 0) {
        const current = args.shift();
        if (!current) {
            continue;
        }

        switch (current) {
            case "-h":
            case "--help":
                options.help = true;
                break;
            case "--out-dir": {
                const value = args.shift();
                if (!value) {
                    throw new Error("Missing value for --out-dir.");
                }
                options.outputDir = value;
                break;
            }
            case "--format": {
                const value = args.shift();
                if (!value) {
                    throw new Error("Missing value for --format.");
                }
                if (value !== "svg" && value !== "png") {
                    throw new Error(`Unsupported format: ${value}. Use svg or png.`);
                }
                options.format = value;
                break;
            }
            case "--all":
            case "--first":
            case "--index": {
                if (selectionWasSet) {
                    throw new Error("Only one of --all, --first, or --index may be used.");
                }
                selectionWasSet = true;

                if (current === "--all") {
                    options.selection = "all";
                    break;
                }

                if (current === "--first") {
                    options.selection = "first";
                    break;
                }

                const value = args.shift();
                if (!value) {
                    throw new Error("Missing value for --index.");
                }
                const selectedIndex = Number.parseInt(value, 10);
                if (!Number.isInteger(selectedIndex) || selectedIndex < 1) {
                    throw new Error(`Invalid --index value: ${value}. Expected a positive integer.`);
                }
                options.selection = "index";
                options.selectedIndex = selectedIndex;
                break;
            }
            default:
                if (current.startsWith("-")) {
                    throw new Error(`Unknown option: ${current}`);
                }
                positionals.push(current);
                break;
        }
    }

    if (positionals.length > 1) {
        throw new Error("Only one input file may be provided.");
    }

    if (!options.help) {
        options.inputPath = positionals[0];
        if (!options.inputPath) {
            throw new Error("Missing input file path.");
        }
    }

    return options;
}
