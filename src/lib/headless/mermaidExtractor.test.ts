import test from "node:test";
import assert from "node:assert/strict";
import { extractMermaidBlocks, selectMermaidBlocks } from "./mermaidExtractor.ts";

test("extractMermaidBlocks finds a single mermaid fence", () => {
    const blocks = extractMermaidBlocks("```mermaid\ngraph TD\nA-->B\n```");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].index, 1);
    assert.equal(blocks[0].code, "graph TD\nA-->B");
});

test("extractMermaidBlocks finds multiple mermaid fences and ignores other code", () => {
    const markdown = [
        "```mermaid",
        "graph TD",
        "A-->B",
        "```",
        "",
        "```ts",
        'console.log("skip");',
        "```",
        "",
        "~~~mermaid extra",
        "sequenceDiagram",
        "Alice->>Bob: hi",
        "~~~",
    ].join("\n");

    const blocks = extractMermaidBlocks(markdown);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].code, "graph TD\nA-->B");
    assert.equal(blocks[1].code, "sequenceDiagram\nAlice->>Bob: hi");
});

test("selectMermaidBlocks returns the requested block by 1-based index", () => {
    const blocks = extractMermaidBlocks("```mermaid\nA\n```\n```mermaid\nB\n```");
    const selected = selectMermaidBlocks(blocks, "index", 2);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].code, "B");
});

test("selectMermaidBlocks rejects out-of-range indexes", () => {
    const blocks = extractMermaidBlocks("```mermaid\nA\n```");
    assert.throws(() => selectMermaidBlocks(blocks, "index", 2), /out of range/);
});
