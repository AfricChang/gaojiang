# Wenyan Mermaid CLI

Wenyan bundles a command line Mermaid exporter with the desktop application on Windows.

The command is installed in the application's resources directory and is not added to `PATH`.

## Usage

Run the command from Wenyan's installed `resources` directory, or call it with its full path.

```powershell
.\gaojiang-mermaid.cmd "article.md"
.\gaojiang-mermaid.cmd "article.md" --format png
.\gaojiang-mermaid.cmd "article.md" --format svg --out-dir output
.\gaojiang-mermaid.cmd "article.md" --index 2 --format png
.\gaojiang-mermaid.cmd "diagram.mmd" --format svg
```

## Inputs

Supported input files:

- `.md`
- `.markdown`
- `.mmd`

Markdown files are scanned for fenced Mermaid code blocks only. The rest of the Markdown document is not rendered by this CLI.

## Outputs

Supported formats:

- `svg`
- `png`

Single selected diagram output:

```text
article.svg
article.png
```

Multiple selected diagrams output:

```text
article.mermaid-01.svg
article.mermaid-02.svg
article.mermaid-01.png
article.mermaid-02.png
```

## Runtime Dependency

The CLI uses the system Microsoft Edge or Google Chrome browser for headless rendering.

It does not bundle Chromium and does not require users to install Node.js or pnpm.

If no supported browser is available, install Microsoft Edge or Google Chrome and run the command again.

## Exit Codes

- `0`: Export completed without Mermaid render failures.
- `1`: Input validation failed, no Mermaid blocks were found, no supported browser was available, or one or more selected diagrams failed to render.
