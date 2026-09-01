import childProcess from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const launcherPath = path.join(repoRoot, "src-tauri", "resources", "gaojiang-mermaid.cmd");
const fixturePath = path.join(repoRoot, "src", "lib", "headless", "test-fixtures", "two-diagrams.md");

if (process.platform !== "win32") {
    console.log("Skipping Gaojiang Mermaid CLI smoke test because the product CLI is currently Windows-only.");
    process.exit(0);
}

async function assertFileExists(filePath) {
    await fs.access(filePath);
}

function runCli(args) {
    const result = childProcess.spawnSync(launcherPath, args, {
        encoding: "utf8",
        shell: process.platform === "win32",
        stdio: "pipe",
    });

    if (result.status !== 0) {
        if (result.error) {
            throw result.error;
        }
        throw new Error(
            [
                `gaojiang-mermaid failed with exit code ${result.status ?? "unknown"}.`,
                `stdout:\n${result.stdout}`,
                `stderr:\n${result.stderr}`,
            ].join("\n")
        );
    }
}

await assertFileExists(launcherPath);

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gaojiang-mermaid-product-"));
const svgDir = path.join(tempDir, "svg");
const pngDir = path.join(tempDir, "png");

runCli([fixturePath, "--out-dir", svgDir, "--format", "svg"]);
runCli([fixturePath, "--out-dir", pngDir, "--format", "png"]);

const svgPath = path.join(svgDir, "two-diagrams.mermaid-01.svg");
const pngPath = path.join(pngDir, "two-diagrams.mermaid-01.png");

await assertFileExists(svgPath);
await assertFileExists(pngPath);

const svg = await fs.readFile(svgPath, "utf8");
if (!svg.includes("<svg")) {
    throw new Error(`${svgPath} does not look like an SVG file.`);
}

const png = await fs.readFile(pngPath);
const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
if (!pngSignature.every((byte, index) => png[index] === byte)) {
    throw new Error(`${pngPath} does not look like a PNG file.`);
}

console.log(`Product Mermaid CLI smoke test passed in ${tempDir}`);
