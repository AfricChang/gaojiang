import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";

function formatError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
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
            "Failed to launch a headless browser for PDF export.",
            "Install Microsoft Edge or Google Chrome, then run the command again.",
            ...failures,
        ].join("\n")
    );
}

async function waitForImages(page: import("playwright").Page) {
    await page.waitForFunction(
        async () => {
            const images = Array.from(document.images);
            await Promise.all(
                images.map((image) => {
                    if (image.complete) {
                        return Promise.resolve(true);
                    }
                    return new Promise((resolve) => {
                        image.addEventListener("load", resolve, { once: true });
                        image.addEventListener("error", resolve, { once: true });
                    });
                })
            );
            return true;
        },
        undefined,
        { timeout: 120_000 }
    );
}

function parseArgs(argv: string[]) {
    const [inputHtmlPath, outputPdfPath] = argv;
    if (!inputHtmlPath || !outputPdfPath) {
        throw new Error("Usage: pdf-export <input.html> <output.pdf>");
    }
    return {
        inputHtmlPath: path.resolve(inputHtmlPath),
        outputPdfPath: path.resolve(outputPdfPath),
    };
}

const { inputHtmlPath, outputPdfPath } = parseArgs(process.argv.slice(2));

await fs.access(inputHtmlPath);
await fs.mkdir(path.dirname(outputPdfPath), { recursive: true });

const browser = await launchHeadlessBrowser();
const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { width: 1240, height: 1754 },
});

try {
    await page.goto(pathToFileURL(inputHtmlPath).href, { waitUntil: "networkidle", timeout: 120_000 });
    await page.emulateMedia({ media: "print" });
    await page.evaluate(() => document.fonts?.ready);
    await waitForImages(page);

    await page.pdf({
        path: outputPdfPath,
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
    });
} finally {
    await page.close();
    await browser.close();
}
