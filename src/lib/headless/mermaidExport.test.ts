import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { exportMermaidFromFile } from "./mermaidExport.ts";
import { getMermaidRuntimeUrl } from "./mermaidRenderer.ts";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "test-fixtures");
const cliEntry = path.resolve("scripts/mermaid-export.ts");

function runCli(args: string[]): Promise<{ code: number | null; stderr: string; stdout: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["--experimental-strip-types", cliEntry, ...args], {
            cwd: path.resolve("."),
            stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk) => {
            stdout += String(chunk);
        });
        child.stderr.on("data", (chunk) => {
            stderr += String(chunk);
        });
        child.on("error", reject);
        child.on("close", (code) => {
            resolve({ code, stderr, stdout });
        });
    });
}

test("headless renderer resolves Mermaid from the local package", () => {
    assert.match(getMermaidRuntimeUrl(), /mermaid\.min\.js$/);
});

test("exportMermaidFromFile renders an .mmd file to a single SVG", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gaojiang-mermaid-mmd-"));
    const inputPath = path.join(fixturesDir, "diagram.mmd");

    const result = await exportMermaidFromFile({
        format: "svg",
        inputPath,
        outputDir: tempDir,
        selection: "all",
    });

    assert.equal(result.failures.length, 0);
    assert.equal(result.writtenFiles.length, 1);
    assert.match(path.basename(result.writtenFiles[0]), /^diagram\.svg$/);

    const svg = await fs.readFile(result.writtenFiles[0], "utf8");
    assert.match(svg, /<svg/);
    assert.match(svg, /data-gaojiang-mermaid="true"/);
});

test("exportMermaidFromFile renders an .mmd file to a PNG", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gaojiang-mermaid-png-"));
    const inputPath = path.join(fixturesDir, "diagram.mmd");

    const result = await exportMermaidFromFile({
        format: "png",
        inputPath,
        outputDir: tempDir,
        selection: "all",
    });

    assert.equal(result.failures.length, 0);
    assert.equal(result.writtenFiles.length, 1);
    assert.match(path.basename(result.writtenFiles[0]), /^diagram\.png$/);

    const png = await fs.readFile(result.writtenFiles[0]);
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

test("exportMermaidFromFile renders all Mermaid blocks from Markdown to numbered SVGs", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gaojiang-mermaid-md-"));
    const inputPath = path.join(fixturesDir, "two-diagrams.md");

    const result = await exportMermaidFromFile({
        format: "svg",
        inputPath,
        outputDir: tempDir,
        selection: "all",
    });

    assert.equal(result.failures.length, 0);
    assert.deepEqual(
        result.writtenFiles.map((file) => path.basename(file)),
        ["two-diagrams.mermaid-01.svg", "two-diagrams.mermaid-02.svg"]
    );
});

test("CLI supports --format png", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "gaojiang-mermaid-cli-png-"));
    const inputPath = path.join(fixturesDir, "diagram.mmd");

    const run = await runCli([inputPath, "--out-dir", outputDir, "--format", "png"]);
    assert.equal(run.code, 0);
    assert.match(run.stdout, /diagram\.png/);

    const png = await fs.readFile(path.join(outputDir, "diagram.png"));
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

test("CLI supports --first and --index selection", async () => {
    const firstDir = await fs.mkdtemp(path.join(os.tmpdir(), "gaojiang-mermaid-first-"));
    const secondDir = await fs.mkdtemp(path.join(os.tmpdir(), "gaojiang-mermaid-index-"));
    const inputPath = path.join(fixturesDir, "two-diagrams.md");

    const firstRun = await runCli([inputPath, "--out-dir", firstDir, "--first"]);
    assert.equal(firstRun.code, 0);
    assert.match(firstRun.stdout, /two-diagrams\.svg/);

    const secondRun = await runCli([inputPath, "--out-dir", secondDir, "--index", "2"]);
    assert.equal(secondRun.code, 0);
    assert.match(secondRun.stdout, /two-diagrams\.svg/);

    const firstSvg = await fs.readFile(path.join(firstDir, "two-diagrams.svg"), "utf8");
    const secondSvg = await fs.readFile(path.join(secondDir, "two-diagrams.svg"), "utf8");
    assert.match(firstSvg, /Extract Mermaid/);
    assert.match(secondSvg, /CLI/);
});

test("CLI returns a non-zero exit code when no Mermaid block exists", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "gaojiang-mermaid-empty-"));
    const inputPath = path.join(fixturesDir, "no-mermaid.md");

    const run = await runCli([inputPath, "--out-dir", outputDir]);
    assert.notEqual(run.code, 0);
    assert.match(run.stderr, /No Mermaid code blocks found/);
});

test("CLI returns a non-zero exit code and reports invalid Mermaid syntax", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "gaojiang-mermaid-invalid-"));
    const inputPath = path.join(fixturesDir, "invalid.mmd");

    const run = await runCli([inputPath, "--out-dir", outputDir]);
    assert.notEqual(run.code, 0);
    assert.match(run.stderr, /Mermaid block 1 failed:/);
});
