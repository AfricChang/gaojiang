import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const generatedPaths = [
    path.join(repoRoot, "dist-cli"),
    path.join(repoRoot, "src-tauri", "resources", "mermaid-cli"),
    path.join(repoRoot, "src-tauri", "resources", "gaojiang-mermaid.cmd"),
];

await Promise.all(generatedPaths.map((target) => fs.rm(target, { force: true, recursive: true })));

