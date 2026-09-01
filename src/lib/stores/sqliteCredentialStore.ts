import { DBInstance } from "$lib/stores/db";
import type { CredentialStoreAdapter, CredentialType, GenericCredential } from "@gaojiang/ui";

interface CredentialDO {
    id: number;
    type: CredentialType;
    name: string;
    appId: string;
    appSecret: string;
    accessToken: string;
    refreshToken: string;
    expireTime: number;
    updatedAt: number;
    refreshLockUntil: number | null;
    createdAt: string;
}

interface oldGzhImageHost {
    type: string;
    appId: string;
    appSecret: string;
    accessToken: string;
    expireTime: number;
    isEnabled: boolean;
}

export const sqliteCredentialStoreAdapter: CredentialStoreAdapter = {
    async load(): Promise<GenericCredential[]> {
        const db = await DBInstance.getInstance();
        const rows = await db.select<CredentialDO[]>("SELECT * FROM Credential;");
        if (rows.length > 0) {
            return rows.map((row) => ({
                type: row.type,
                name: row.name ?? "",
                appId: row.appId ?? "",
                appSecret: row.appSecret ?? "",
            }));
        }
        // 兼容旧数据
        const imageHostsStr = localStorage.getItem("customImageHosts");
        const imageHosts = JSON.parse(imageHostsStr ?? "[]") as oldGzhImageHost[];
        if (imageHosts.length > 0) {
            await this.save({
                type: "wechat",
                name: "wechat",
                appId: imageHosts[0].appId,
                appSecret: imageHosts[0].appSecret,
            });
            await updateWechatAccessToken(imageHosts[0].accessToken, imageHosts[0].expireTime);
            localStorage.removeItem("customImageHosts");
            return [
                {
                    type: "wechat",
                    name: "wechat",
                    appId: imageHosts[0].appId,
                    appSecret: imageHosts[0].appSecret,
                },
            ];
        }
        return [];
    },
    async save(credential: GenericCredential): Promise<void> {
        const db = await DBInstance.getInstance();
        const row = await db.select<CredentialDO[]>("SELECT * FROM Credential WHERE type = $1;", [credential.type]);
        if (row.length === 0) {
            await db.execute(
                "INSERT INTO Credential (type, name, appId, appSecret, accessToken, refreshToken, expireTime, updatedAt, createdAt) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);",
                [
                    credential.type,
                    credential.name ?? null,
                    credential.appId ?? null,
                    credential.appSecret ?? null,
                    null,
                    null,
                    0,
                    new Date().getTime(),
                    new Date().toISOString(),
                ],
            );
        } else {
            await db.execute(
                "UPDATE Credential SET name = $1, appId = $2, appSecret = $3, updatedAt = $4 WHERE type = $5;",
                [
                    credential.name ?? null,
                    credential.appId ?? null,
                    credential.appSecret ?? null,
                    new Date().getTime(),
                    credential.type,
                ],
            );
        }
    },
    async remove(type: string): Promise<void> {
        throw new Error("Function not implemented.");
    },
};

const WECHAT = "wechat";

/** 刷新锁最长持有时间。持锁进程崩溃时靠它自动过期，避免死锁 */
const REFRESH_LOCK_TTL_MS = 15_000;
/** 未拿到锁的进程等待他人写回结果的上限，需小于 TTL 才有意义 */
const REFRESH_WAIT_TIMEOUT_MS = 12_000;
const REFRESH_POLL_INTERVAL_MS = 300;

export async function getWechatToken(): Promise<CredentialDO | null> {
    const db = await DBInstance.getInstance();
    // 必须按 type 过滤：原实现取 SELECT * 的第一行，一旦将来存在第二种凭据就会读错行，
    // 而下面的 CAS 与锁全部按 type 定位，读写不一致会导致判断失效。
    const rows = await db.select<CredentialDO[]>("SELECT * FROM Credential WHERE type = $1;", [WECHAT]);
    return rows.length > 0 ? rows[0] : null;
}

/** 返回仍在有效期内的 access_token，过期或缺失则返回 null */
export async function getValidWechatAccessToken(): Promise<string | null> {
    const row = await getWechatToken();
    if (row?.accessToken && row.expireTime && Date.now() < row.expireTime) {
        return row.accessToken;
    }
    return null;
}

/**
 * 尝试取得 access_token 刷新锁，返回 true 表示由本进程负责去微信取新 token。
 *
 * 锁就是 Credential.refreshLockUntil 这一个时间戳，靠 UPDATE 的 WHERE 条件做原子性判断：
 * 只有"当前无锁或锁已过期"时才能写入，SQLite 保证同一时刻只有一个 UPDATE 生效。
 */
async function acquireRefreshLock(): Promise<boolean> {
    const db = await DBInstance.getInstance();
    const now = Date.now();
    const result = await db.execute(
        `UPDATE Credential SET refreshLockUntil = $1
         WHERE type = $2 AND (refreshLockUntil IS NULL OR refreshLockUntil < $3);`,
        [now + REFRESH_LOCK_TTL_MS, WECHAT, now],
    );
    return result.rowsAffected > 0;
}

async function releaseRefreshLock(): Promise<void> {
    const db = await DBInstance.getInstance();
    await db.execute("UPDATE Credential SET refreshLockUntil = NULL WHERE type = $1;", [WECHAT]);
}

/**
 * 轮询等待持锁进程把新 token 写回。等到返回该 token，超时返回 null。
 *
 * 用轮询而非事件是因为跨进程通知本身要额外机制，而这里的等待窗口只有十几秒、
 * 且仅在 token 恰好过期时才会发生（token 有效期 7200 秒），成本可以忽略。
 */
async function waitForRefreshedToken(): Promise<string | null> {
    const deadline = Date.now() + REFRESH_WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, REFRESH_POLL_INTERVAL_MS));
        const token = await getValidWechatAccessToken();
        if (token) return token;
    }
    return null;
}

/**
 * 在刷新锁保护下取 access_token：有效则直接用，否则由单一进程去微信取。
 *
 * fetchToken 由调用方注入，避免 store 层依赖 http 客户端。
 */
export async function withWechatTokenRefresh(
    fetchToken: () => Promise<{ accessToken: string; expireTime: number }>,
): Promise<string> {
    const cached = await getValidWechatAccessToken();
    if (cached) return cached;

    let holdsLock = await acquireRefreshLock();
    if (!holdsLock) {
        // 别的进程正在刷新，等它写回，避免重复向微信取 token
        const shared = await waitForRefreshedToken();
        if (shared) return shared;
        // 等超时了：持锁进程可能已崩溃，或锁已过期。再抢一次，抢不到也继续自己取。
        holdsLock = await acquireRefreshLock();
    }
    try {
        // 双重检查：等锁与抢锁期间对方可能已经写好了
        const fresh = await getValidWechatAccessToken();
        if (fresh) return fresh;

        const { accessToken, expireTime } = await fetchToken();
        return await commitWechatAccessToken(accessToken, expireTime);
    } finally {
        // 只释放自己持有的锁，不碰别人的
        if (holdsLock) await releaseRefreshLock();
    }
}

/**
 * 写回新 token，返回最终应当使用的 token。
 *
 * 只在本次取到的 token 比库里更晚过期时才写入（CAS）。若写入未生效，说明别的进程
 * 已经写了更新的 token，则改用库里那份——否则两个进程各持一份，先前那份会被微信侧失效。
 */
export async function commitWechatAccessToken(accessToken: string, expireTime: number): Promise<string> {
    const db = await DBInstance.getInstance();
    const result = await db.execute(
        `UPDATE Credential SET accessToken = $1, expireTime = $2, updatedAt = $3
         WHERE type = $4 AND (expireTime IS NULL OR expireTime < $2);`,
        [accessToken, expireTime, Date.now(), WECHAT],
    );
    if (result.rowsAffected > 0) return accessToken;
    const row = await getWechatToken();
    return row?.accessToken || accessToken;
}

/** 无条件写入，仅供旧数据迁移使用（迁移时不存在并发） */
export async function updateWechatAccessToken(accessToken: string, expireTime: number) {
    const db = await DBInstance.getInstance();
    await db.execute("UPDATE Credential SET accessToken = $1, expireTime = $2, updatedAt = $3 WHERE type = $4;", [
        accessToken,
        expireTime,
        new Date().getTime(),
        WECHAT,
    ]);
}

export async function resetWechatAccessToken() {
    const db = await DBInstance.getInstance();
    // 顺手清掉刷新锁：用户手动重置 token 后，不该让残留的锁把下一次刷新拖十几秒
    await db.execute(
        `UPDATE Credential SET accessToken = $1, expireTime = $2, updatedAt = $3, refreshLockUntil = NULL
         WHERE type = $4;`,
        [null, 0, new Date().getTime(), WECHAT],
    );
}
