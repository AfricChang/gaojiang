import type { ArticleStorageAdapter, Article } from "@gaojiang/ui";
import { DBInstance } from "./db";

export interface ArticleDO {
    id: number;
    pid: string | null;
    lastSeen: string | null;
    title: string;
    content: string;
    fileName: string | null;
    filePath: string | null;
    relativePath: string | null;
    createdAt: string;
}

const OLD_ARTICLE_STORAGE_KEY = "lastArticle";
const PROCESS_ID_KEY = "wenyan.processId";

/** 取最近写入的行：lastSeen 缺失时退回 createdAt，保证老数据也能排序 */
const ORDER_BY_RECENT = "ORDER BY COALESCE(lastSeen, createdAt) DESC, id DESC";

let processId: string | null = null;

/**
 * 本进程唯一 ID。
 *
 * sessionStorage 的作用域是当前窗口/进程，进程关闭即销毁，天然隔离。
 * 先读后写是关键：否则 webview 热重载或手动刷新会换掉 ID，本进程就丢了自己的行。
 * 惰性求值同样是必须的——+layout.ts 里 prerender = true，
 * 模块顶层直接访问 sessionStorage 会在构建期的 Node 环境炸掉。
 */
function getProcessId(): string {
    if (processId) return processId;
    let id = sessionStorage.getItem(PROCESS_ID_KEY);
    if (!id) {
        id = crypto.randomUUID();
        sessionStorage.setItem(PROCESS_ID_KEY, id);
    }
    processId = id;
    return id;
}

interface DocumentPath {
    fileName: string | null;
    filePath: string | null;
    relativePath: string | null;
}

/**
 * 本进程当前打开的文档路径，只存在内存里——这是多进程隔离的关键。
 *
 * 路径属于"本进程当前状态"而不是持久数据，它当初进 DB 只因为单窗口设计把
 * "草稿缓存"和"当前文件指针"塞进了同一行。多进程下共用最近一行必然互相覆盖：
 * 进程 A 开 docA、B 开 docB，A 解析图片相对路径时会用上 docB 的目录。
 * 放进内存后各进程互不可见，串扰从根上消失。
 *
 * null 表示本进程还没取过路径，此时从 DB 快照一次（上次会话的恢复提示）。
 * 字段全为 null 的对象表示"已显式清空"（如拖入无来源文件），不再回落 DB。
 */
let currentPath: DocumentPath | null = null;

export const sqliteArticleStorageAdapter: ArticleStorageAdapter = {
    async load(): Promise<Article[]> {
        const db = await DBInstance.getInstance();
        // 不限 pid 取最近一行:"恢复上次编辑的文档"是跨进程共享语义。
        // 只取一行是因为 ArticleStore 仅使用 _articles[0]，多返回的行永远不会被读到。
        const rows = await db.select<ArticleDO[]>(`SELECT * FROM Article ${ORDER_BY_RECENT} LIMIT 1;`);
        if (rows.length > 0) {
            const row = rows[0];
            return [
                {
                    id: String(row.id),
                    title: row.title,
                    content: row.content,
                    created: new Date(row.createdAt).getTime(),
                },
            ];
        }
        // 兼容旧数据
        const singleArticleData = localStorage.getItem(OLD_ARTICLE_STORAGE_KEY);
        if (singleArticleData) {
            const legacyArticle: Article = {
                id: "1",
                title: "last article",
                content: singleArticleData,
                created: Date.now(),
            };
            await this.save(legacyArticle);
            localStorage.removeItem(OLD_ARTICLE_STORAGE_KEY);
            return [legacyArticle];
        }
        return [];
    },
    async save(article: Article): Promise<void> {
        const db = await DBInstance.getInstance();
        const pid = getProcessId();
        const now = new Date().toISOString();
        // 只认本进程自己的行，A 与 B 各写各的，正文不再互相覆盖。
        // 不能用 article.id 定位：ArticleStore 新建条目时给的是 uuid，与 DB 的 INTEGER id 无关。
        const own = await db.select<{ id: number }[]>(
            "SELECT id FROM Article WHERE pid = $1 ORDER BY id DESC LIMIT 1;",
            [pid],
        );
        if (own.length === 0) {
            // 首次落行时带上当前路径，否则下次启动恢复不到文件名与相对目录
            await db.execute(
                `INSERT INTO Article (pid, lastSeen, title, content, fileName, filePath, relativePath, createdAt)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
                [
                    pid,
                    now,
                    article.title,
                    article.content,
                    currentPath?.fileName ?? null,
                    currentPath?.filePath ?? null,
                    currentPath?.relativePath ?? null,
                    now,
                ],
            );
        } else {
            await db.execute(
                "UPDATE Article SET title = $1, content = $2, createdAt = $3, lastSeen = $4 WHERE id = $5;",
                [article.title, article.content, now, now, own[0].id],
            );
        }
    },
    async remove(id: string): Promise<void> {
        const db = await DBInstance.getInstance();
        // 加 pid 约束避免删掉别的进程的行（当前 ArticleStore 并未调用此方法）
        await db.execute("DELETE FROM Article WHERE id = $1 AND pid = $2;", [id, getProcessId()]);
    },
};

/**
 * 读本进程当前文档的路径。
 *
 * 首次调用时从 DB 快照一次作为恢复值，之后固定用内存值——
 * 快照而非每次查询，是为了防止本进程尚未打开文档期间，别的进程改写 DB 又污染进来。
 */
async function getCurrentPath(): Promise<DocumentPath> {
    if (currentPath) return currentPath;
    const db = await DBInstance.getInstance();
    const rows = await db.select<ArticleDO[]>(
        `SELECT fileName, filePath, relativePath FROM Article ${ORDER_BY_RECENT} LIMIT 1;`,
    );
    currentPath =
        rows.length > 0
            ? { fileName: rows[0].fileName, filePath: rows[0].filePath, relativePath: rows[0].relativePath }
            : { fileName: null, filePath: null, relativePath: null };
    return currentPath;
}

export async function updateLastArticlePath(
    fileName: string | null,
    filePath: string | null,
    relativePath: string | null,
): Promise<void> {
    // 先落内存：隔离在这里生效，且不依赖 DB 里是否已有本进程的行
    currentPath = { fileName, filePath, relativePath };

    const db = await DBInstance.getInstance();
    // 再写 DB，仅作为下次启动的恢复提示。本进程还没有行时影响 0 行，
    // 由后续 save() 的 INSERT 带上 currentPath 补齐。
    await db.execute(
        "UPDATE Article SET fileName = $1, filePath = $2, relativePath = $3, lastSeen = $4 WHERE pid = $5;",
        [fileName, filePath, relativePath, new Date().toISOString(), getProcessId()],
    );
}

export async function getLastArticleRelativePath(): Promise<string | null> {
    return (await getCurrentPath()).relativePath;
}

export async function getLastArticleFileName(): Promise<string | null> {
    return (await getCurrentPath()).fileName;
}

export async function getLastArticleFilePath(): Promise<string | null> {
    return (await getCurrentPath()).filePath;
}
