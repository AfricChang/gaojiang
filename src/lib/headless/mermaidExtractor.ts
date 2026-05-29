export interface MermaidBlock {
    index: number;
    code: string;
}

const OPENING_FENCE_RE = /^ {0,3}((`{3,}|~{3,}))(.*)$/;

export function extractMermaidBlocks(markdown: string): MermaidBlock[] {
    const lines = markdown.split(/\r?\n/);
    const blocks: MermaidBlock[] = [];

    let activeFence: {
        char: "`" | "~";
        length: number;
        isMermaid: boolean;
        lines: string[];
    } | null = null;

    for (const line of lines) {
        if (!activeFence) {
            const match = line.match(OPENING_FENCE_RE);
            if (!match) {
                continue;
            }

            const fence = match[1];
            const infoString = match[3].trim();
            const firstToken = infoString.split(/\s+/, 1)[0]?.toLowerCase() ?? "";

            activeFence = {
                char: fence[0] as "`" | "~",
                length: fence.length,
                isMermaid: firstToken === "mermaid",
                lines: [],
            };
            continue;
        }

        const closingFence = new RegExp(`^ {0,3}${activeFence.char}{${activeFence.length},}\\s*$`);
        if (closingFence.test(line)) {
            if (activeFence.isMermaid) {
                blocks.push({
                    index: blocks.length + 1,
                    code: activeFence.lines.join("\n"),
                });
            }
            activeFence = null;
            continue;
        }

        activeFence.lines.push(line);
    }

    return blocks;
}

export function selectMermaidBlocks(
    blocks: MermaidBlock[],
    selection: "all" | "first" | "index",
    selectedIndex?: number
): MermaidBlock[] {
    if (blocks.length === 0) {
        return [];
    }

    switch (selection) {
        case "first":
            return [blocks[0]];
        case "index": {
            if (!selectedIndex || selectedIndex < 1 || selectedIndex > blocks.length) {
                throw new Error(`Mermaid index ${selectedIndex ?? "?"} is out of range. Available blocks: 1-${blocks.length}.`);
            }
            return [blocks[selectedIndex - 1]];
        }
        case "all":
        default:
            return blocks;
    }
}
