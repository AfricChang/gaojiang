import Database from "@tauri-apps/plugin-sql";

/**
 * 连接级配置，必须在建表之前执行。
 *
 * - journal_mode=WAL 是写进数据库文件的持久属性，设一次后续所有连接与进程都生效，
 *   多进程可并发读、写入串行化但不锁死读，是多进程并发的主要防护。
 * - busy_timeout 是 per-connection 的。plugin-sql 底层是 sqlx 连接池，
 *   这里只作用于当次借出的连接，池中其它连接不一定继承，因此不能只靠它。
 */
async function configureConnection(db: Database): Promise<void> {
    try {
        // PRAGMA journal_mode 会返回一行结果（生效后的模式），需用 select 才能读回来
        const rows = await db.select<{ journal_mode: string }[]>("PRAGMA journal_mode=WAL;");
        const mode = rows?.[0]?.journal_mode;
        if (mode?.toLowerCase() !== "wal") {
            console.warn("journal_mode 未切换到 WAL，当前为:", mode ?? "unknown");
        }
    } catch (error) {
        // 个别驱动版本下 PRAGMA 走 select 会报错，回退到 execute
        console.warn("以 select 设置 journal_mode 失败，回退到 execute:", error);
        await db.execute("PRAGMA journal_mode=WAL;");
    }
    await db.execute("PRAGMA busy_timeout=5000;");
}

/**
 * 加列（若不存在）。ALTER TABLE 不支持 IF NOT EXISTS，需先查 PRAGMA table_info。
 * 表名/列名只接受代码里的字面量——标识符本来也无法用绑定参数传。
 */
async function addColumnIfMissing(db: Database, table: string, column: string, type: string): Promise<void> {
    const columns = await db.select<{ name: string }[]>(`PRAGMA table_info(${table});`);
    if (columns.some((existing) => existing.name === column)) return;
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`);
}

/**
 * 增量迁移。所有新增列都可空，加列本身不改变任何现有查询的行为。
 *
 * Article.pid：进程唯一 ID，多进程下用于隔离各进程的正文行。
 * Article.lastSeen：该行最后被写入的时间，用于回收僵尸行的排序（不是存活心跳）。
 * Credential.refreshLockUntil：access_token 刷新锁的到期时间戳，
 *   防止多进程同时向微信取 token 导致彼此的 token 失效。
 */
async function migrateSchema(db: Database): Promise<void> {
    await addColumnIfMissing(db, "Article", "pid", "TEXT");
    await addColumnIfMissing(db, "Article", "lastSeen", "TEXT");
    await addColumnIfMissing(db, "Credential", "refreshLockUntil", "INTEGER");
}

/**
 * 回收僵尸行。
 *
 * 每个进程写自己的 Article 行，进程退出后行会留下，需要主动回收。
 * 同时受两个上限约束，取更严的那个：
 *
 * - KEEP_ARTICLE_ROWS：最多保留多少行
 * - ARTICLE_BUDGET_BYTES：保留行的 content 总字节上限
 *
 * 为什么光有行数上限不够：初版按"一篇约 17 KB"估算，取 10 行以为占用 170 KB。
 * 实测踩到一篇 1.7 MB 的文档（生成的 SDK 头文件索引，16 万条函数声明），
 * 10 行就是 17 MB，估算差 100 倍。行数上限对文档体量的假设根本不成立，必须按字节兜底。
 *
 * 刻意不用 lastSeen < datetime('now','-N day') 这类时间比较：
 * lastSeen 由 JS 的 toISOString() 写入，形如 2026-08-30T03:35:00.000Z，
 * 而 SQLite datetime() 产出 2026-08-30 03:35:00，字典序比较时 'T'(84) > ' '(32)，
 * 会漏删一批本该删的行。按行数与字节保留则完全不涉及时间格式。
 *
 * 误删活进程的行是无害的：该进程下次 save() 会重新 INSERT，
 * 而它的路径信息在内存里（见 sqliteArticleStore 的 currentPath），不受影响。
 */
const KEEP_ARTICLE_ROWS = 10;
const ARTICLE_BUDGET_BYTES = 2 * 1024 * 1024;

async function cleanupZombieRows(db: Database): Promise<void> {
    // rn = 1 让最近写入的那行无条件保留：单篇文档本身就超预算时（1.7 MB 那种），
    // 若按字节把它也删掉，"恢复上次文档"就失效了。
    await db.execute(
        `DELETE FROM Article WHERE id NOT IN (
            SELECT id FROM (
                SELECT id,
                       SUM(LENGTH(content)) OVER (
                           ORDER BY COALESCE(lastSeen, createdAt) DESC, id DESC
                           ROWS UNBOUNDED PRECEDING
                       ) AS running,
                       ROW_NUMBER() OVER (
                           ORDER BY COALESCE(lastSeen, createdAt) DESC, id DESC
                       ) AS rn
                FROM Article
            )
            WHERE rn = 1 OR (rn <= ${KEEP_ARTICLE_ROWS} AND running <= ${ARTICLE_BUDGET_BYTES})
        );`,
    );
}

export class DBInstance {
    private static instance: Database | null = null;
    private static initPromise: Promise<Database> | null = null;

    static async getInstance(): Promise<Database> {
        if (DBInstance.instance) return DBInstance.instance;

        if (DBInstance.initPromise) return DBInstance.initPromise;

        DBInstance.initPromise = (async () => {
            const db = await Database.load("sqlite:data.db");
            await configureConnection(db);
            await db.execute(`CREATE TABLE IF NOT EXISTS CustomTheme (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                content TEXT NOT NULL,
                createdAt TEXT NOT NULL
            );`);
            await db.execute(`CREATE TABLE IF NOT EXISTS Article (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pid TEXT,
                lastSeen TEXT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                fileName TEXT,
                filePath TEXT,
                relativePath TEXT,
                createdAt TEXT NOT NULL
            );`);
            await db.execute(`CREATE TABLE IF NOT EXISTS Credential (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                name TEXT,
                appId TEXT,
                appSecret TEXT,
                accessToken TEXT,
                refreshToken TEXT,
                expireTime INTEGER,
                updatedAt INTEGER,
                refreshLockUntil INTEGER,
                createdAt TEXT NOT NULL
            );`);
            await db.execute(`CREATE TABLE IF NOT EXISTS UploadCache (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                md5 TEXT NOT NULL,
                mediaId TEXT NOT NULL,
                url TEXT NOT NULL,
                lastUsed TEXT NOT NULL,
                createdAt TEXT NOT NULL
            );`);
            await migrateSchema(db);
            await cleanupZombieRows(db);
            DBInstance.instance = db;
            return db;
        })();

        return DBInstance.initPromise;
    }
}
