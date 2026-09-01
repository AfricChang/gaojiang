# 方案 B：多进程支持实施计划

> 状态：**步骤一~六全部已实施**（详见 §9 状态表）
> 目标：让文颜支持多进程多开，每个进程独立编辑不同文档，互不干扰
> 修订：2026-08-31 对照代码复核，补齐 load() 缺口、PROCESS_ID 持久化、僵尸行回收、
> 认领竞态、WAL 验证与行为变化六处漏洞（详见 §3.4 / §3.5 / 步骤三 / 步骤五 / §10）
>
> ⚠️ 步骤三与步骤五**实施时改了设计**，与本文原方案不同：路径改存内存而非按 pid 存 DB，
> 回收改为保留最近 N 行而非心跳 + 时间阈值。原方案的硬伤与新设计的理由记录在两节内部。
>
> 核心目标已于 2026-08-31 人工实测通过：两进程分别打开不同目录的含相对图片文档，
> 各自图片都正确解析（测试夹具与方法见 §7 末）。

## 1. 核心思路

移除 tauri-plugin-single-instance 单实例限制，每次启动 文颜.exe 都是独立 OS 进程。
利用操作系统的进程隔离，让每个进程天然拥有独立的 JS 运行时——globalState、appState、articleStore
等前端单例无需任何改造，每个进程的 relativePath 天然隔离，图片相对路径不会串扰。

**前端零改动**，所有改动集中在 Rust 侧和 SQLite 层。

> 注意：「前端零改动」成立的前提是 Article 表的**每一处**查询都按进程隔离。
> 初版计划漏了 `sqliteArticleStorageAdapter.load()`（见 §3.4），不补的话文章列表会跨进程串数据，
> 这个卖点就不成立。

## 2. 为什么选多进程而非多窗口

| 维度 | 多窗口（方案 A） | 多进程（方案 B） |
|------|------------------|------------------|
| 前端状态隔离 | 需改 wenyan-ui 子模块几十处单例 | **不用改**（OS 进程隔离） |
| 图片 relativePath | 每窗口隔离，改架构 | **不用改**（天然隔离） |
| SQLite 并发 | 多连接共享 | WAL + Article 多行 |
| 改动集中度 | 分散在子模块 | 集中在 Rust + DB |
| 窗口体验 | 同进程多窗口 | 每进程一个窗口（窗口数 = 进程数） |

关于窗口与任务栏的准确描述：`tauri.conf.json` 的 `windows` 数组只有一项，
且全仓唯一的 `WebviewWindowBuilder` 调用是注释掉的 about 窗口（main.rs:67），
因此**一个进程只能有一个窗口，进程内无法再开窗口**。
屏幕上看到 N 个窗口 = 跑了 N 个进程。

⚠️ 任务栏**不会**出现多个独立图标——Windows 默认按应用身份把同一 exe 的多个实例
归组到一个任务栏按钮下，悬停才展开多个预览。**不要用"出现多个任务栏图标"当验收标准**。

多进程把隔离成本交给操作系统，而非前端重构。

## 3. 当前障碍点

### 3.1 单实例插件

src-tauri/src/main.rs 第 17-24 行注册了 tauri-plugin-single-instance
（依赖声明在 src-tauri/Cargo.toml 第 25 行）：
第二次启动 exe 不会开新进程，而是把文件路径通过 open-file 事件转发给已有进程。

### 3.2 Article 表"最近一条"模型

sqliteArticleStore.ts 的 save() / getLastArticle() 只操作 ORDER BY id DESC LIMIT 1，
多进程会互相覆盖同一行的 fileName / filePath / relativePath，导致：
进程 A 打开 docA → 进程 B 打开 docB → 进程 A 的图片相对路径解析用了 docB 的目录。

受影响的读取方（都经由 getLastArticle()，改一处即可全覆盖）：

- src/lib/imageProcessor.svelte.ts:73
- src/lib/services/exportHandler.ts:98
- src/lib/services/imageUploadService.ts:30
- src/lib/services/markdownContentHandler.ts:7,16
- src/lib/setHooks.ts:106
- src/routes/+page.svelte:28-29（标题栏文档名/路径）

### 3.3 SQLite 默认无 WAL

多进程并发写同一 data.db 会触发 database is locked 错误。

**2026-08-31 查证（结论：本条成立，新装用户确实是非 WAL）：**

- 全新建库的 journal_mode 默认是 `delete`（`sqlite3` 实测），不是 WAL。
- sqlx-sqlite 0.8.6 明确**不设** journal_mode：`src/options/mod.rs:181`
  `pragmas.insert("journal_mode".into(), None);`，注释写 "Don't set journal_mode unless
  the user requested it"。
- tauri-plugin-sql 2.3.2 源码中**完全没有** journal_mode / pragma 相关代码。

即：不显式设置的话，**新装用户的库一直是 `delete` 模式**，多进程必然撞 database is locked。

⚠️ 但**不要**用「我这台机器的库已经是 WAL」来验证步骤二。开发机上的 data.db 实测
journal_mode 已是 `wal`，而 git 历史里 db.ts 从未设过该 pragma（`git log -S journal_mode` 为空），
属于来源不明的历史遗留。**已有库是否 WAL 因人而异，不可依赖**，验证必须用全新库（见 §7）。

### 3.4 load() / save() / remove() 绕过 getLastArticle()

**初版计划遗漏的缺口。** 步骤三只改 getLastArticle() 是不够的——
sqliteArticleStore.ts 里有三处自带 SQL、不走 getLastArticle() 的查询：

| 位置 | 现有 SQL | 不改的后果 |
|------|----------|-----------|
| load():19 | `SELECT * FROM Article ORDER BY id DESC;` | 进程 A 的文章列表列出进程 B 的全部文档 |
| save():46 | `SELECT * FROM Article ORDER BY id DESC;` | 进程 A 保存时覆盖进程 B 的行 |
| remove():65 | `DELETE FROM Article WHERE id = $1;` | 可删掉别的进程正在用的行 |

其中 load() 还有一个升级路径问题：孤儿行认领逻辑在 getLastArticle() 里，
而进程启动时 load() 先跑、PROCESS_ID 是全新的，`WHERE pid = $1` 返回 0 行，
于是直接落到 localStorage 兼容分支 → **升级后首次启动看不到上次的文档**。
load() 必须先触发一次认领（见步骤三）。

### 3.5 僵尸行会随启动次数线性膨胀

PROCESS_ID 随进程销毁，因此**每次启动 app 都会新增一行 Article**，且没有任何一方删除旧行。
初版计划风险表估「每条仅几百字节」是错的：Article.content 存的是**整篇 markdown 正文**，
单行可达数十 KB。开一百次就是一百份全文副本。需要主动回收（步骤五）。

实测佐证（2026-08-31，开发机真实库）：唯一一行 Article 的
`LENGTH(content)` = **17,296 字节**，对应一篇普通文档。按此体量，开 100 次约 1.7 MB
全文副本，且只会单调增长。初版估算差了约两个数量级。

## 4. 实施步骤

### 步骤一：移除单实例插件

**文件：src-tauri/Cargo.toml**

删除这一行（第 25 行）：

    tauri-plugin-single-instance = "=2.4.0"

**文件：src-tauri/src/main.rs**

删除 main() 中的整个 .plugin(tauri_plugin_single_instance::init(...)) 块（第 17-24 行）。

移除后：
- 双击 exe / 双击 .md 文件 → 每次启动独立进程
- 文件参数通过 std::env::args() 获取（已有逻辑，setup 里第 33-38 行），无需改动
- 前端 initFileOpenListener → open-file 事件链路保留，用于进程内打开文件（如文件树点击）

用户可见的行为变化见 §10，实施前请一并确认。

### 步骤二：SQLite 启用 WAL 模式

**文件：src/lib/stores/db.ts**

在 Database.load() 之后、建表之前加：

    const db = await Database.load("sqlite:data.db");

    // PRAGMA journal_mode 会返回一行结果（生效后的模式），
    // 用 select 才能拿到返回值——不要 execute 完就假定生效。
    const mode = await db.select<{ journal_mode: string }[]>("PRAGMA journal_mode=WAL;");
    console.log("journal_mode:", mode);   // 期望 [{ journal_mode: "wal" }]

    // 增大忙等待，减少锁冲突
    await db.execute("PRAGMA busy_timeout=5000;");

WAL 模式下：
- 多个进程可同时读
- 写入串行化但不会锁死读操作
- busy_timeout=5000 让写冲突时自动重试 5 秒

**两个必须知道的细节：**

1. **journal_mode 是持久属性**，写进 db 文件本身，设一次后续所有连接/进程都生效；
   **busy_timeout 是 per-connection 的**，每条连接都要设。
   而 tauri-plugin-sql 底层是 sqlx 连接池，单次 `db.execute("PRAGMA busy_timeout=...")`
   只作用于池中当次借出的那条连接。**需实测确认是否每条连接都生效**；
   若不生效，退路是在 Rust 侧构造连接池时统一设置，或接受「WAL 本身已大幅降低冲突」。

   补充（2026-08-31 查证）：`busy_timeout=5000` 恰好等于 sqlx 自己的默认值
   （sqlx-sqlite 0.8.6 `src/options/mod.rs:201` → `Duration::from_secs(5)`），
   所以这行实际是冗余的，保留只为显式表达意图、并防将来 sqlx 改默认值。
   连接池继承问题因此也不必担心——默认值本就作用于每条连接。

2. **WAL 不支持网络盘**，以及部分同步盘（OneDrive / Dropbox 目录）行为异常。
   data.db 位于 appdata 下，一般没问题，但若用户把配置目录重定向到同步盘需留意。

   ⚠️ **备份 / 复制数据库时必须连 `data.db-wal` 一起复制**，否则丢掉尚未 checkpoint 的写入。
   实测踩过：app 运行中只 `cp data.db` 得到的副本少了最近两行（它们还在 WAL 里）。
   安全做法是先关掉所有实例（干净关闭会 checkpoint 并删除 `-wal`），
   或复制 `data.db` + `data.db-wal` + `data.db-shm` 三个文件。
   判断副本是否完整：备份时目录里没有 `-wal` 文件即说明已 checkpoint。

3. **切换进/出 WAL 需要排他锁，且 busy_timeout 等不了它。** sqlx 源码注释原话：
   "changing into or out of it requires an exclusive lock that can't be waited on with
   `sqlite3_busy_timeout()`"。推论：全新安装（库为 `delete` 模式）时若两个进程几乎同时首启，
   抢着设 WAL，其中一个会拿不到排他锁而失败。
   本实现把它降级为 console.warn 而非抛异常，因此不会崩，但那次会话可能仍停在 `delete` 模式。
   一旦任意一次成功切到 WAL，之后就是持久的，不再复现。

### 步骤三：Article 表改为"每进程一条"

多进程下 Article 表不再只有"最近一条"，而是每个进程写入自己的行。
关键是：进程启动时创建自己专属的行，后续只操作该行。

**方案：用进程唯一 ID 标识每条 Article**

**文件：src/lib/stores/db.ts** — 建表加 pid、lastSeen 两列：

    CREATE TABLE IF NOT EXISTS Article (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pid TEXT,                             -- 新增：进程唯一 ID
        lastSeen TEXT,                        -- 新增：本进程最后活跃时间，用于回收僵尸行
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        fileName TEXT,
        filePath TEXT,
        relativePath TEXT,
        createdAt TEXT NOT NULL
    );

**文件：src/lib/stores/sqliteArticleStore.ts**

> ⚠️ **本节设计已于 2026-08-31 实施时变更。** 下面先记录被否决的原方案及原因，再给实际实现。

#### 被否决的原方案（认领孤儿行）及其硬伤

原计划让 `getLastArticle()` 按 `pid` 查自己的行，查不到就认领一条 `pid IS NULL` 的孤儿行。
**这条路走不通**：迁移后 `pid IS NULL` 的行只存在一次，被首个进程认领后库里再无无主行，
于是从第 2 次启动起 `getLastArticle()` 恒返回 `null` → `load()` 返回 `[]` →
**"恢复上次文档"永久失效**。这不是边界情况，是必然结果。

试图用"lastSeen 超过存活窗口即视为无主，可被认领"来补，会引出新的两难：

- 窗口取短（几分钟）→ 关掉 app 立刻重开会认领成功，但休眠唤醒后活进程的行可能被抢
- 窗口取长（半小时）→ 关掉 app 立刻重开时行还"活着"，认领不到，仍然恢复不了文档

要彻底解决就得在窗口关闭时显式释放 pid，而 `onCloseRequested` 里做异步 DB 写不可靠，
还得改动关窗行为。**代价与收益不成比例**。

#### 实际实现：路径存内存，正文按进程分行

关键认识：**串扰的根源是路径被当成了持久数据。** `relativePath` / `fileName` / `filePath`
描述的是"本进程当前打开的文档"，属于会话状态；它当初进 DB 只因为单窗口设计把
"草稿缓存"和"当前文件指针"塞进了同一行。把路径移到内存，串扰从根上消失，
不需要 pid、不需要心跳、不需要存活窗口、不需要退出释放。

四条改动：

**① 路径改为进程内内存态**

    interface DocumentPath {
        fileName: string | null;
        filePath: string | null;
        relativePath: string | null;
    }
    let currentPath: DocumentPath | null = null;

语义约定（两种"空"必须区分开）：

| currentPath 取值 | 含义 | getCurrentPath() 行为 |
|------------------|------|----------------------|
| `null` | 本进程还没取过路径 | 从 DB 快照一次作为恢复值 |
| 字段全为 `null` 的对象 | 已显式清空（如 setHooks.ts:106 拖入无来源文件） | 直接返回，**不**回落 DB |

`getCurrentPath()` 是**快照**而非每次查询——否则本进程尚未打开文档期间，
别的进程改写 DB 会污染进来，串扰以更隐蔽的形式复活：

    async function getCurrentPath(): Promise<DocumentPath> {
        if (currentPath) return currentPath;
        const db = await DBInstance.getInstance();
        const rows = await db.select<ArticleDO[]>(
            `SELECT fileName, filePath, relativePath FROM Article ${ORDER_BY_RECENT} LIMIT 1;`,
        );
        currentPath = rows.length > 0 ? { ...rows[0] } : { fileName: null, filePath: null, relativePath: null };
        return currentPath;
    }

`updateLastArticlePath()` 先落内存再写 DB，DB 那份只作为下次启动的恢复提示：

    currentPath = { fileName, filePath, relativePath };
    await db.execute(
        "UPDATE Article SET fileName = $1, filePath = $2, relativePath = $3, lastSeen = $4 WHERE pid = $5;",
        [fileName, filePath, relativePath, new Date().toISOString(), getProcessId()],
    );

用 `WHERE pid = ?` 省掉一次 SELECT；本进程还没有行时影响 0 行，由后续 `save()` 的 INSERT 补齐。

**② PROCESS_ID 惰性求值 + sessionStorage 先读后写**

原计划的模块顶层 IIFE **会让构建失败**：`src/routes/+layout.ts` 设了 `prerender = true`，
顶层访问 `sessionStorage` 在构建期的 Node 环境里没有该全局对象。必须惰性：

    let processId: string | null = null;
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

先读后写同样不能省，否则 webview 热重载/手动刷新会换 ID，本进程丢掉自己的行。

**③ save() 按 pid 写自己的行**（正文不再跨进程互相覆盖）

    const own = await db.select<{ id: number }[]>(
        "SELECT id FROM Article WHERE pid = $1 ORDER BY id DESC LIMIT 1;", [pid]);
    if (own.length === 0) {
        // 首次落行带上当前路径，否则下次启动恢复不到文件名与相对目录
        await db.execute(`INSERT INTO Article (pid, lastSeen, title, content,
            fileName, filePath, relativePath, createdAt) VALUES (...)`, [...]);
    } else {
        await db.execute("UPDATE Article SET title=$1, content=$2, createdAt=$3, lastSeen=$4 WHERE id=$5;", [...]);
    }

⚠️ **不能用 `article.id` 定位本进程的行。** 查 wenyan-ui 的 `ArticleStore.saveLastArticle()`：
新建条目时 `id` 是 `uuidv4()`，与 DB 的 `INTEGER id` 毫无关系，必须自己按 pid 查。

**④ load() 读最近一行，不限 pid**（恢复语义保持不变）

    const rows = await db.select<ArticleDO[]>(`SELECT * FROM Article ${ORDER_BY_RECENT} LIMIT 1;`);

不限 pid 是有意的："恢复上次编辑的文档"本就是跨进程共享语义，
这样也就绕开了原方案"认领不到就恢复不了"的死结。

只取一行而非原来的全部行——查 `ArticleStore` 源码，`getLastArticle()` 读 `_articles[0]`、
`saveLastArticle()` 写 `_articles[0]`，**它本质是单槽缓存**，多返回的行永远不会被读到。
所以「§3.4 说 load() 不加 pid 过滤会让文章列表串数据」这个担心其实不成立——
根本没有文章列表 UI 在消费这个数组。真正需要修的只有路径（①）和正文（③）。

顺带确认：`remove()` 在整个 wenyan-ui 里**没有任何调用方**，属于死代码，
仍按 `WHERE id = $1 AND pid = $2` 加上约束以防将来被调用。

    ORDER_BY_RECENT = "ORDER BY COALESCE(lastSeen, createdAt) DESC, id DESC"

`lastSeen` 缺失时退回 `createdAt`，保证迁移前的老行也能正确排序。
注意 `lastSeen` 在本实现中语义是"该行最后被写入的时间"，**不是进程存活心跳**——
没有心跳机制，别按存活性去理解它。

### 步骤四：数据库迁移（兼容已有数据）

db.ts 建表后加迁移（两列都要判断，ALTER TABLE 不支持 IF NOT EXISTS）：

    const columns = await db.select<{ name: string }[]>("PRAGMA table_info(Article);");
    const has = (c: string) => columns.some((x) => x.name === c);
    if (!has("pid")) {
        await db.execute("ALTER TABLE Article ADD COLUMN pid TEXT;");
    }
    if (!has("lastSeen")) {
        await db.execute("ALTER TABLE Article ADD COLUMN lastSeen TEXT;");
    }

迁移后旧数据的 pid 为 NULL，由步骤三的认领逻辑接管：首个启动的进程拿走它，
后续进程各自 INSERT 新行。

CustomTheme / Credential / UploadCache 三张表无需加 pid——
它们是跨进程共享的配置/缓存。但 Credential 的 token 刷新有并发隐患，见 §6。

### 步骤五：僵尸行回收（初版计划缺失）

**为什么必须做：** 见 §3.5——每次启动新增一行完整正文副本（实测一篇约 17 KB），不回收会线性膨胀。

> ⚠️ **本节设计已于 2026-08-31 实施时变更**，原方案（心跳 + 按 lastSeen 时间回收）被否决。

#### 原方案被否决的两个原因

**一、"不能只保留最新 N 行"的论证前提已不成立。** 原文担心：长期开着的进程 A 的行会被
进程 B 的裁剪删掉，A 随后丢失 relativePath / fileName，图片相对路径解析失败。
这个担心建立在"路径存在 DB 里"之上。步骤三改为路径存内存后，
**删掉活进程的行不再有任何影响**——该进程的路径在内存里，下次 `save()` 会重新 INSERT 一行。
误删从"触发目标 bug"降级为"无害且自愈"。

**二、原方案的 SQL 有隐藏 bug。** `lastSeen < datetime('now', '-1 day')` 里两侧格式不一致：

| 来源 | 格式 |
|------|------|
| `lastSeen`（JS `toISOString()` 写入） | `2026-08-30T03:35:00.000Z` |
| `datetime('now','-1 day')`（SQLite） | `2026-08-30 03:35:00` |

字典序比较时第 11 个字符 `'T'`(0x54) > `' '`(0x20)，所以**日期部分相同、时间更早的行会被判为"更大"而漏删**。
举例：now = `2026-08-31 03:35`，阈值 = `2026-08-30 03:35`，
某行 lastSeen = `2026-08-30T01:00:00.000Z`（确实超过一天）却不会被删。
实际效果退化成"按日期边界粗粒度回收"，不可靠。

若坚持按时间回收，正确写法是在 JS 侧算好阈值再传参（格式由构造保证一致）：

    const threshold = new Date(Date.now() - 7 * 86400_000).toISOString();
    await db.execute("DELETE FROM Article WHERE lastSeen < $1 ...", [threshold]);

或用 `strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')` 对齐格式。

#### 实际实现：保留最近写入的 N 行

不涉及时间比较，也不需要心跳：

    const KEEP_ARTICLE_ROWS = 10;

    async function cleanupZombieRows(db: Database): Promise<void> {
        await db.execute(
            `DELETE FROM Article WHERE id NOT IN (
                SELECT id FROM Article
                ORDER BY COALESCE(lastSeen, createdAt) DESC, id DESC
                LIMIT ${KEEP_ARTICLE_ROWS}
            );`,
        );
    }

在 `DBInstance.getInstance()` 里于 `migrateSchema()` 之后调用一次。

行数收敛分析：

- 每次启动 PROCESS_ID 都是新的（sessionStorage 随进程销毁），`save()` 找不到自己的行 → INSERT
- 所以**每次启动净增一行**，稳态由清理封顶
- 清理在本进程 INSERT 之前跑，稳态在 10~11 行之间摆动，约 170 KB，有界且每次启动都收敛
- 并发进程数超过 10 时会删到活进程的行——如上所述无害且自愈

`COALESCE(lastSeen, createdAt)` 让迁移前的老行（`lastSeen` 为 NULL）也能正确参与排序，
不会因为 NULL 排在末尾而被优先删掉。

**没有心跳。** `lastSeen` 在本实现里的语义是"该行最后被写入的时间"（`save()` /
`updateLastArticlePath()` 时刷新），**不表示进程存活**。不要按存活性理解它。

### 步骤六：access_token 并发去重

**问题：** `wechatHandler.ts` 的 `auth()` 原本是"读库 → 过期就取新的 → 写库"，
三步之间没有任何跨进程协调。两个进程同时发布且 token 恰好过期时，双方都会向微信请求
`/cgi-bin/token`。微信侧重复取 token 会使先前那份失效，于是**后写回的进程赢，
先前那个进程手里的 token 变成废的**，它的上传/发布会报 40001。

次要代价：`/cgi-bin/token` 有日调用上限，双发翻倍消耗。

**实现：DB 级刷新锁 + CAS 写回，两层防护。**

**① Credential 加一列**（步骤四的 `migrateSchema` 顺带迁移）：

    refreshLockUntil INTEGER    -- 刷新锁到期时间戳，NULL 表示无锁

**② 锁的原子性靠 UPDATE 的 WHERE 条件**，不需要额外事务：

    async function acquireRefreshLock(): Promise<boolean> {
        const now = Date.now();
        const result = await db.execute(
            `UPDATE Credential SET refreshLockUntil = $1
             WHERE type = $2 AND (refreshLockUntil IS NULL OR refreshLockUntil < $3);`,
            [now + REFRESH_LOCK_TTL_MS, "wechat", now],
        );
        return result.rowsAffected > 0;
    }

"当前无锁或锁已过期"写在 WHERE 里，SQLite 保证同一时刻只有一个 UPDATE 生效，
`rowsAffected` 就是"我拿到锁了吗"的答案。`REFRESH_LOCK_TTL_MS = 15s` 让持锁进程崩溃时锁自动过期，
不会死锁。

**③ 未拿到锁的进程等对方写回**（轮询，上限 12s < TTL）：

    while (Date.now() < deadline) {
        await sleep(300);
        const token = await getValidWechatAccessToken();
        if (token) return token;
    }
    return null;   // 超时 → 再抢一次锁，抢不到也自己去取（降级但可用）

用轮询而非跨进程事件：等待窗口只有十几秒，且仅在 token 恰好过期时才发生
（有效期 7200 秒），成本可忽略，不值得引入通知机制。

**④ 写回用 CAS，防覆盖更新的 token**：

    UPDATE Credential SET accessToken = $1, expireTime = $2, updatedAt = $3
    WHERE type = $4 AND (expireTime IS NULL OR expireTime < $2);

`rowsAffected = 0` 说明别的进程已写入更晚过期的 token，此时**改用库里那份**而非自己那份——
否则两进程各持一份，先前那份会被微信侧失效。这是锁失效时（TTL 过期、崩溃恢复）的第二道防线。

**⑤ 顺带修掉一个既有缺陷：** `getWechatToken()` 原本是 `SELECT * FROM Credential` 取第一行，
**没按 type 过滤**。当前库里只有 wechat 一条所以没暴露，但一旦增加第二种凭据就会读错行，
而上面的锁与 CAS 全部按 `type` 定位，读写不一致会让判断直接失效。已改为
`WHERE type = $1`。

**⑥ 分层：** 锁与 CAS 都在 `sqliteCredentialStore.ts`，向外暴露
`withWechatTokenRefresh(fetchToken)`，实际的 HTTP 请求由 `wechatHandler.ts` 以回调注入——
store 层不依赖 http 客户端。

`resetWechatAccessToken()`（用户手动重置 token 的入口，setHooks.ts:52）同时清掉
`refreshLockUntil`，否则残留的锁会把紧接着的一次刷新拖十几秒。

**残留窗口（未消除，也无法仅靠 DB 消除）：** 若持锁进程在取到 token 后卡住超过 TTL，
另一进程会抢锁并再取一次，此时前者手里的 token 可能已被微信失效。
CAS 保证库里最终收敛到一份，但已经发出的请求救不回来。真要彻底消除需要重试机制
（捕获 40001 后重取 token 再试一次），属于另一件事。

## 5. 不需要改的部分

| 模块 | 原因 |
|------|------|
| 前端 globalState / appState / articleStore | 进程隔离，单例照旧 |
| imageProcessor.svelte.ts | relativePath 来自本进程的 Article 行，天然隔离 |
| markdownContentHandler.ts | 调用链不变 |
| fileOpenHandler.ts | open-file 事件链路不变 |
| setHooks.ts | 无关 |
| CustomTheme / UploadCache | 共享数据，WAL 足够 |
| Credential | 表结构不变，但 token 刷新需去重，见 §6 |
| tauri.conf.json 窗口配置 | 单窗口配置不变，每个进程一个窗口 |
| 自动更新 | 流程不变，但 Windows 安装器与多实例冲突需实测，见 §6 |

## 6. 风险与对策

| 风险 | 概率 | 对策 |
|------|------|------|
| SQLite 写锁冲突 | 低 | WAL + busy_timeout（步骤二）；注意 busy_timeout 的连接池问题 |
| Article 表僵尸行积累 | **必然** | **每行含整篇正文（实测 17 KB），非"几百字节"；步骤五按行数回收，稳态 10~11 行** |
| 旧数据无 pid / lastSeen 列 | 必然 | 步骤四迁移；老行 pid 保持 NULL 不被触碰，仅作 load() 的恢复来源 |
| ~~认领孤儿行竞态~~ | — | 已不适用：实施时取消了认领机制（见步骤三） |
| 同一文件被两进程打开 | 中 | 见 §10，当前接受"后写覆盖"；如需防护可加 filePath 占用检查 |
| 公众号 access_token 并发刷新 | 中 | **已处理（步骤六）**：DB 刷新锁让单一进程去取，CAS 写回防覆盖更新的 token。<br>残留窗口：持锁进程卡超 TTL 时仍可能双发，需靠 40001 重试才能彻底消除 |
| 多进程同时检查更新 | 低 | Tauri Updater 自带去重；或加文件锁 |
| Windows 安装器遇多实例 | 中 | NSIS/MSI 会因 exe 被占用而失败或强杀，须按 §7 清单实测 |

### 关于进程标识的选择

推荐用 crypto.randomUUID() + sessionStorage，而非 OS PID：
- sessionStorage 作用域是当前窗口/进程，天然隔离，进程关闭即销毁
- 不受 PID 复用影响，比 OS PID 更可靠
- 纯前端实现，不依赖额外 Tauri API

代价是 ID 不跨重启保留，因此每次启动净增一行——由步骤五按行数回收兜底。

## 7. 验收清单

勾选状态截至 2026-09-01。`[x]` 为已实测通过，`[ ]` 为待验。

**构建与启动**
- [x] 移除 tauri-plugin-single-instance 后 cargo build 通过 —— `cargo check` exit 0，无 warning
- [x] 双击 exe 能启动多个独立进程 —— 实测两个进程 PID 46840 / 37424 并存
- [x] pnpm exec svelte-check 0 错误

**核心隔离**
- [x] ~~进程 A 的文章列表**不**出现进程 B 的文档~~ —— **本条作废**：查 ArticleStore 源码，
      它只用 `_articles[0]`，是单槽缓存，不存在文章列表 UI，load() 返回多行也无人消费
- [x] **进程 A 打开 docA、B 打开 docB（不同目录、含相对图片），各自图片都正确解析**
      —— 2026-08-31 15:3x 人工实测通过。这是本方案的核心目标，路径隔离是内存态属性，
      DB 查询与静态检查都证明不了，只能人工验
- [ ] 进程 A 的标题栏文档名与 B 各自独立（+page.svelte:28-29）
- [x] 两进程各写自己的 Article 行，不再共用一行 —— 实测 3 行 / 2 个不同 pid，
      迁移前老行 pid 仍为 NULL 未被触碰

**并发与共享**
- [ ] 两进程同时发布公众号不报 database is locked
- [ ] 两进程接近同时发布，access_token 不互相失效（步骤六已实现刷新锁，**开发机无微信凭据，未能实测**）
- [ ] 进程 A 改主题，进程 B 重启后能看到（共享 CustomTheme 表）
- [x] 运行期 data.db-wal / data.db-shm 出现 —— 实测已出现
- [ ] `PRAGMA journal_mode` 返回 "wal"
      —— **必须用全新库验证**：先把 data.db 移开让 app 重建，否则开发机上已是 WAL 的旧库
      会让这一条无论改没改都"通过"（见 §3.3）。上面那条 -wal 文件出现同理，不能作为步骤二的证据

**迁移与回收**
- [x] Credential.refreshLockUntil / Article.pid / Article.lastSeen 迁移 SQL 干跑通过；
      裸重复加列会报 `duplicate column name`，证明 addColumnIfMissing 的守卫必要
- [x] 清理 SQL 干跑通过：12 行 → 精确保留最新 10 行，lastSeen 为 NULL 的老行按 createdAt 正确参与排序
- [x] **字节上限清理经 app 真实代码路径端到端验证**（2026-09-01）：
      向真实库插 8 行 2019 年时间戳的假数据（共 15 行）→ 启动 release exe →
      裁到 10 行（7 真实 + 3 个最新假行 ZZTEST-8/7/6，删掉 ZZTEST-1~5）→
      应用随后插入自己的行 = 11 行，与"稳态 10~11 行"的预测一致。
      这一条是关键：窗口函数 SQL 若在应用自带的 SQLite 里不被支持，
      `cleanupZombieRows` 会抛异常导致 `DBInstance.getInstance()` 失败、启动即坏。
      验完已删净假行并 VACUUM，`integrity_check` = ok
- [x] 刷新锁 SQL 干跑通过：无锁可抢(1)、未过期不可抢(0)、已过期可抢(1)、释放置 NULL
- [x] CAS 写回 SQL 干跑通过：更晚过期可写(1)、更早过期被拒(0) 且保留原 token
- [x] 旧版本数据迁移后正常加载 —— pid / lastSeen 两列已加到真实库，
      两个进程都成功恢复出 SDK_Index.md
- [x] `refreshLockUntil` 经 app 代码路径真实迁移 —— 跑 release exe 前查 `pragma_table_info`
      计数为 0，跑后为 1（列索引 10），迁移调用链已验证
- [ ] 反复启动关闭 20 次，Article 行数收敛在 10~11 行不再增长
      —— 注：实测增长比预期慢。`save()` 只在 `saveLastArticle()` 被触发时才写，
      恢复的内容没变化时不写，因此"每次启动净增一行"是上界而非常态
- [x] ~~长时间开着的进程 A，在 B 多次启动后仍能正确解析图片相对路径~~
      —— **前提已消失**：路径进内存后，回收误删活进程的行不再影响该进程的路径解析
- [ ] webview 手动刷新（右键 → 重新加载）后，进程仍持有同一行（验证 sessionStorage 先读后写）

**更新**
- [ ] 自动更新在**有多个实例运行时**的表现：能否正常安装，还是需先提示用户关闭全部窗口

### 路径隔离的测试夹具（重要）

⚠️ **别用手边随便一篇文档测这一条。** 2026-08-31 第一次「测起来没问题」是假通过：
当时用的 `倾斜单体生成流程.md` 与 `SDK_Index.md` 都**不含任何图片**
（用 grep 搜 `![`、`<img`、`.png`、`.jpg`、`.svg` 全部零匹配），
相对路径解析压根没被触发，那个测试当时不可能失败，因此也证明不了任何事。

专用夹具（一次性生成，可随时删除）：

    E:\wenyan-mp-test\docA\文档A.md   →  ![](pic.png)   pic.png = 红色 360x220
    E:\wenyan-mp-test\docB\文档B.md   →  ![](pic.png)   pic.png = 蓝色 360x220

设计要点：**两个目录里的图片同名但颜色不同**。路径串了不是「图裂」而是「显示成另一种颜色」，
判定无歧义，也排除了「串到的目录里恰好没这个文件」这种含糊情况。

步骤：窗口 A 开 docA（应红）→ 窗口 B 开 docB（应蓝）→ **回到窗口 A 触发重新渲染**
（切主题 / 改一个字 / 导出）。第三步是关键，串扰发生在「B 打开文档之后 A 再解析路径」这一刻，
只开不动看不出来。

| 窗口 A 显示 | 结论 |
|---|---|
| 红色 | 隔离生效 |
| 蓝色 | 路径串到 docB，隔离失效 |
| 图裂 | 相对路径解析到了别处 |

也别用 `SDK_Index.md` 这类大文档测——1.7 MB 会卡在渲染上（见 §12），测不到路径的事。

## 8. 预估工作量

| 改动 | 文件数 | 复杂度 |
|------|--------|--------|
| 移除 single-instance | 2（Cargo.toml + main.rs） | 低 |
| SQLite WAL | 1（db.ts） | 低 |
| Article 加 pid / lastSeen + 迁移 + 回收（行数与字节双上限） | 1（db.ts） | 中 |
| sqliteArticleStore 进程隔离（路径内存态 + save 按 pid） | 1（sqliteArticleStore.ts） | 中 |
| access_token 并发去重（DB 刷新锁 + CAS） | 2（sqliteCredentialStore.ts + wechatHandler.ts） | 中 |
| 测试验证 | - | 中高 |
| **合计** | **约 5 个文件** | **中** |

比初版估算（4 文件 / 中低）略增，主要来自 §3.4 的 load() 缺口、步骤五的回收机制和 token 去重。

## 9. 步骤总览与实施状态

编号与 §4 的步骤标题一致（此前本节曾错列为六步，与 §4 的五步错位，已修正）。

| 步骤 | 内容 | 文件 | 状态 |
|------|------|------|------|
| 一 | 移除 single-instance 插件 | Cargo.toml + main.rs | ✅ 已完成 |
| 二 | SQLite 启用 WAL（select 验证 + busy_timeout） | db.ts | ✅ 已完成 |
| 三 | 进程隔离：路径存内存 + 正文按 pid 分行 | db.ts 建表 + sqliteArticleStore.ts | ✅ 已完成（设计已变更） |
| 四 | 数据库迁移（ALTER TABLE 补列） | db.ts | ✅ 已完成 |
| 五 | 僵尸行回收：保留最近 N 行 | db.ts | ✅ 已完成（设计已变更） |
| 六 | access_token 并发去重：DB 刷新锁 + CAS 写回 | sqliteCredentialStore.ts + wechatHandler.ts + db.ts | ✅ 已完成 |

**步骤三、五的设计变更摘要**（详细论证见各节内部）：

| | 本文原方案 | 实际实现 | 变更原因 |
|---|---|---|---|
| 路径隔离 | Article 行按 pid 存路径，启动时认领孤儿行 | 路径存进程内存，DB 那份降级为恢复提示 | 原方案第 2 次启动起就认领不到行，"恢复上次文档"永久失效 |
| 僵尸行回收 | 心跳 5 分钟 + `lastSeen < datetime('now','-1 day')` | 保留最近写入 10 行，无心跳 | 原 SQL 有 ISO/SQLite 时间格式字典序 bug 会漏删；且路径进内存后误删活进程行已无害 |

**当前代码处于什么状态：** 多进程可用且已隔离。实测（2026-08-31）启动两个实例后
Article 表出现 3 行 / 2 个不同 pid：迁移前的老行 `pid` 仍为 NULL 未被触碰，
两个进程各自 INSERT 了自己的行。运行期 `data.db-wal` / `data.db-shm` 正常出现。

**尚未验证**：路径隔离是内存态属性，DB 查询无法证明。需人工在两个窗口分别打开
**不同目录**的含相对图片文档，确认各自图片都能正确解析（见 §7）。

前端（wenyan-ui 子模块）零改动，改动集中在 src/lib/stores 与 src-tauri。

## 10. 已知行为变化（移除单实例的副作用）

这些是用户可见的变化，不是 bug，但要事先确认能接受：

1. **同一 .md 文件可被两个进程同时打开。** 旧行为是转发给已有进程（同一文档只有一份）。
   移除单实例后各进程独立编辑同一文件，保存时**后写覆盖，无提示**。
   如需防护：save 前按 filePath 查 Article 表是否已被别的活进程持有（lastSeen 新鲜），弹窗提示。
2. **文件关联双击会累积进程。** 连续双击 10 个 .md 就是 10 个进程、10 个窗口
   （任务栏归组在一个按钮下，不是 10 个图标）。
3. **自动更新期间需要用户关闭全部窗口。** Windows 安装器无法覆盖正在运行的 exe。
   建议更新提示文案明确说明，或在安装前枚举并提示剩余实例。
4. **应用内没有任何入口可以开第二个实例。** 这是本方案留下的 UX 缺口：
   旧行为下再次启动会折叠回已有窗口，所以从来不需要"新建窗口"；现在再次启动是多开的**唯一**
   途径，但 app 内既无该菜单项、也无对应代码（全仓 grep `current_exe` 无结果）。
   用户只能回到 exe / 开始菜单 / 任务栏右键应用名重新启动，或双击一个 .md 文件。

   补法很小：标题栏已有"更多"菜单（`+page.svelte:38` toggleMoreMenu →
   `appState.isShowMoreMenu`），加一个"新建窗口"项，Rust 侧加个 command 用
   `std::process::Command::new(std::env::current_exe()?).spawn()` 拉起新进程即可。
   建议与步骤三后半一并做——否则多进程能力实际上很难被用户发现。

## 11. 部署记录

| 时间 | 动作 | 细节 |
|------|------|------|
| 2026-08-31 13:47 | release 构建 | `pnpm exec tauri build --no-bundle`，4m55s，产物 `src-tauri/target/release/文颜.exe`（22,602,240 B） |
| 2026-08-31 13:49 | 替换安装目录 exe | `E:\Program Files\文颜\文颜.exe`，md5 `7c3a72e67353b62004fd8f4b01afe769`，与源逐字节一致 |
| 2026-08-31 13:49 | 备份被换下的 exe | `文颜.exe.bak-20260831-134932`（22,608,896 B，原 08-22 版本） |
| 2026-09-01 08:28 | release 重建（含字节上限修复 `07e67a0`） | `TAURI_EXIT=0`，6m42s，md5 `343796283ae13a1c53633194028d4f96` |
| 2026-09-01 08:31 | 替换安装目录 exe | md5 与源一致（`343796283ae1…`），22,602,240 B |
| 2026-09-01 08:31 | 备份被换下的 exe | `文颜.exe.bak-20260901-083116`（用 `cp -p` 保留原 mtime 2026-08-31 13:49） |

**当前生效版本**：`文颜.exe` md5 `343796283ae13a1c53633194028d4f96`，
对应提交 `07e67a0`（在 `0e68e5b` 多进程之上加了僵尸行回收的字节上限修复）。

**回退方法**：关闭所有 文颜 进程，按需复制对应备份回 `文颜.exe`。

| 想回到 | 用哪个备份 |
|--------|-----------|
| 上一版（多进程，无字节上限） | `文颜.exe.bak-20260901-083116` |
| 多进程之前（08-22 版，无 SVG 也无多进程） | `文颜.exe.bak-20260831-134932` |

注意 DB 迁移**不会**随 exe 回退——`pid` / `lastSeen` / `refreshLockUntil` 三列会留在库里。
这是安全的：三列可空，旧版本代码的 `SELECT *` 读到多余字段不会出错，`INSERT` 也都是显式列名。
若要连数据一起回退，用 `%APPDATA%\com.yztech.WenYan\data.db.bak-before-multiprocess-20260831-111102`
（该备份完整：制作时目录下没有 `-wal` 文件，说明库已 checkpoint）。

**只替换了 exe，没有替换 `resources/`**（安装目录里那份是 2025-07-04 的），沿用此前 5 次替换的做法。
`resolve_pdf_runtime`（main.rs）对 mermaid-cli 路径有多级回退、包括退到系统 Node，
所以 PDF 导出不会因此失效；若发现 PDF / mermaid 相关异常先怀疑这里，
用完整 NSIS 安装包（`pnpm tauri:build`，去掉 `--no-bundle`）覆盖安装即可。

**未随本次部署验证的行为**：见 §7 中仍为 `[ ]` 的条目。最关键的是两进程分别打开
不同目录含相对图片文档时的路径隔离——它是本方案的核心目标，但属于内存态属性，
DB 查询与静态检查都无法证明，必须人工操作两个窗口验证。

## 12. 大文档卡死（与本方案无关的既有问题，2026-08-31 踩到）

替换安装目录 exe 后出现启动即卡死。查明后**与多进程改动无关**，记在此处备查。

**现象**：打开 `E:\Program Files\文颜\文颜.exe` 卡住无响应。

**原因**：`Article` 表最近一行的 `content` 是 **1,737,737 字节**，对应磁盘上的
`D:\work\UGC_Extern\Docs\SuperMap_UGC_1210\SDK_Index.md`（1,737,773 字节，
差 36 字节是行尾/BOM 归一化）。那是一篇生成的 SDK 头文件索引：
7181 个头文件、16965 个类型符号、**169560 条函数声明**。
启动时 `load()` 恢复最近一行，编辑器与预览要渲染这 1.7 MB，就卡在渲染上。

**排除了的猜测**：一度怀疑是 base64 内联图片导致膨胀，查证后 `data:image` 出现次数为 **0**，
就是纯文本文档，与图片处理链路无关。

**为何与本方案无关**：该行写入于 12:35，而替换安装目录 exe 是 13:49 —— 内容早就在库里了。
旧版代码的 `load()` 同样取最近一行，换回旧 exe 也会卡。

**处置**：删掉那两行 1.7 MB 的死进程行 + `VACUUM`，`data.db` 从 3,526,656 字节回落到 40,960 字节，
启动恢复正常。磁盘上的 `SDK_Index.md` 未改动。备份见 §11。

**暴露出的真实缺陷（已修）**：`KEEP_ARTICLE_ROWS = 10` 这个数是按「实测一篇约 17 KB」
（§3.5）定的，以为占用 170 KB。碰上 1.7 MB 的文档就是 **17 MB**，估算差 100 倍——
行数上限对文档体量的假设根本不成立。已改为行数与字节双上限：

    KEEP_ARTICLE_ROWS    = 10
    ARTICLE_BUDGET_BYTES = 2 MB

用窗口函数算按最近排序的累计字节，超预算即裁掉；`rn = 1` 让最新那行**无条件保留**——
否则单篇就超预算时（正是这种 1.7 MB 文档），按字节会把它一起删掉，「恢复上次文档」就失效了。
两种场景已在合成库上验过：3 大 + 2 小共 5 行 → 保留最新 3 行；
最新一行单独 5.2 MB 超预算 → 靠 `rn = 1` 保住。

**仍然存在的限制**：再打开那个 1.7 MB 文档还是会卡。这是应用渲染大文档的既有能力问题，
不在本方案范围内。若要处理，方向是编辑器/预览的虚拟化或分块渲染。
