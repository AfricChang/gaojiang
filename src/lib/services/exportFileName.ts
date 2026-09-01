/**
 * 导出文件名的推导逻辑。
 *
 * 刻意做成纯函数并单独成文件：这里全是字符串规则，不依赖 DOM 与全局状态，
 * 抽出来才能按项目既有约定（node:test）覆盖到。读状态的那一层留在 exportHandler。
 */

export const DEFAULT_EXPORT_BASE_NAME = "wenyan-export";

/** Windows 保留设备名，拿来做文件名会直接失败 */
const RESERVED_FILE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** 文件名最大长度，给扩展名和整体路径长度留余量 */
const MAX_BASE_NAME_LENGTH = 120;

/**
 * 清成合法文件名：去掉各平台非法字符与控制字符、压缩空白，
 * 再处理 Windows 的两个额外限制——不接受结尾的点或空格、保留设备名不可用。
 * 清理后为空（例如整个名字都是非法字符）时返回空串，由调用方决定退路。
 */
export function sanitizeFileName(name: string): string {
    const cleaned = name
        // 拆成两条、每条都不含区间，避免把空格或连字符误并进字符类：
        // "我的报告-v2 终稿" 里空格和连字符是正常字符，删掉就面目全非了。
        .replace(/[<>:"/\\|?*]/g, "")
        // 顺序要紧：先折叠空白，制表符/换行才不会被当控制字符删掉而把词粘在一起
        .replace(/\s+/g, " ")
        .replace(/[\x00-\x1f]/g, "")
        .slice(0, MAX_BASE_NAME_LENGTH)
        .trim()
        .replace(/[. ]+$/, "");
    return RESERVED_FILE_NAMES.test(cleaned) ? "" : cleaned;
}

/** 只去掉 markdown 类扩展名，其余保留（a.b.md → a.b，report.v2 → report.v2） */
export function stripMarkdownExtension(fileName: string): string {
    return fileName.replace(/\.(md|markdown|mdx|txt)$/i, "");
}

/**
 * 去掉标题里的行内标记，避免 `**标题**` 把星号带进文件名。
 * 刻意不动下划线：`my_report` 这类标题里它是正常字符，不该当成强调标记。
 */
export function stripInlineMarkdown(text: string): string {
    return text
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*~`]/g, "")
        .trim();
}

/** 取正文首个 ATX 标题；跳过围栏代码块，否则代码里的注释 # 会被误当标题 */
export function findFirstHeading(markdown: string): string | null {
    let fenceChar = "";
    for (const rawLine of markdown.split(/\r?\n/)) {
        const line = rawLine.trim();

        const fence = /^(`{3,}|~{3,})/.exec(line);
        if (fence) {
            const char = fence[1][0];
            if (!fenceChar) {
                fenceChar = char;
            } else if (fenceChar === char) {
                fenceChar = "";
            }
            continue;
        }
        if (fenceChar) continue;

        // 尾部的 #* 用于兼容闭合式写法：# 标题 #
        const heading = /^#{1,6}[ \t]+(.+?)[ \t]*#*$/.exec(line);
        if (heading) {
            const text = stripInlineMarkdown(heading[1]);
            if (text) return text;
        }
    }
    return null;
}

export interface ExportBaseNameInput {
    /** 当前打开的文档名，含扩展名；无文件来源时为 null */
    documentName: string | null;
    /** front matter 里的 title */
    frontMatterTitle?: string;
    /** 正文 markdown，用于在没有 front matter title 时找首个标题 */
    markdown?: string;
}

/**
 * 按「文档名 → 标题 → 默认名」定出导出文件名的基名（不含扩展名）。
 *
 * 文档名放最前是因为它最可预期：文件从哪儿打开，导出就叫什么。
 * 没有文档名（粘贴或拖入的内容）时退到标题，先看 front matter 的 title，再找正文首个标题。
 * 每一级都要过 sanitizeFileName，清理后为空则继续往下退。
 */
export function pickExportBaseName({ documentName, frontMatterTitle, markdown }: ExportBaseNameInput): string {
    if (documentName) {
        const fromDocument = sanitizeFileName(stripMarkdownExtension(documentName));
        if (fromDocument) return fromDocument;
    }

    const title = frontMatterTitle?.trim() || (markdown ? findFirstHeading(markdown) : null);
    if (title) {
        const fromTitle = sanitizeFileName(title);
        if (fromTitle) return fromTitle;
    }

    return DEFAULT_EXPORT_BASE_NAME;
}
