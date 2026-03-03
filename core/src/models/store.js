const process = require('node:process');
/**
 * 运行时存储 - 自动化开关、种子偏好、账号管理
 */

const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const { readTextFile, readJsonFile, writeJsonFileAtomic } = require('../services/json-db');

const STORE_FILE = getDataFile('store.json');
const ACCOUNTS_FILE = getDataFile('accounts.json');
const ALLOWED_PLANTING_STRATEGIES = ['preferred', 'level', 'max_exp', 'max_fert_exp', 'max_profit', 'max_fert_profit'];
const PUSHOO_CHANNELS = new Set([
    'webhook', 'qmsg', 'serverchan', 'pushplus', 'pushplushxtrip',
    'dingtalk', 'wecom', 'bark', 'gocqhttp', 'onebot', 'atri',
    'pushdeer', 'igot', 'telegram', 'feishu', 'ifttt', 'wecombot',
    'discord', 'wxpusher',
]);
const DEFAULT_OFFLINE_REMINDER = {
    channel: 'webhook',
    reloginUrlMode: 'none',
    endpoint: '',
    token: '',
    title: '账号下线提醒',
    msg: '账号下线',
    offlineDeleteSec: 120,
};
// ============ 全局配置 ============
const DEFAULT_ACCOUNT_CONFIG = {
    automation: {
        farm: true,
        farm_push: true,   // 收到 LandsNotify 推送时是否立即触发巡田
        land_upgrade: true, // 是否自动升级土地
        farm_water: true,  // 自己农场自动浇水
        farm_weed: true,   // 自己农场自动除草
        farm_bug: true,    // 自己农场自动除虫
        friend: true,       // 好友互动总开关
        friend_help_exp_limit: true, // 帮忙经验达上限后自动停止帮忙
        friend_steal: true, // 偷菜
        friend_water: true, // 自动好友浇水
        friend_weed: true,  // 自动好友除草
        friend_bug: true,   // 自动好友除虫
        friend_bad: false,  // 捣乱(放虫草)
        task: true,
        email: true,
        fertilizer_gift: false,
        fertilizer_buy: false,
        /** 施肥细分：种植后第一时间施普通肥 */
        farm_fertilizer_normal: true,
        /** 施肥细分：种植后施一次有机肥 */
        farm_fertilizer_organic_once: false,
        /** 施肥细分：防偷（剩余秒数内施一次有机肥加速成熟） */
        farm_fertilizer_anti_steal: false,
        /** 防偷识别：剩余多少秒内施一次有机肥，默认 300 */
        farm_fertilizer_anti_steal_sec: 300,
        /** 施肥细分：连续施有机肥（按策略间隔） */
        farm_fertilizer_organic_loop: false,
        /** 施肥细分：自动使用化肥礼包（开启后自动打开背包中的化肥礼包） */
        farm_fertilizer_use_gift_pack: true,
        free_gifts: true,
        share_reward: true,
        vip_gift: true,
        month_card: true,
        open_server_gift: true,
        sell: false,  // 自动卖果实，默认关闭
        fertilizer: 'none',
        /** 普通肥料施肥间隔（毫秒），默认 50 */
        fertilizer_interval_normal_ms: 50,
        /** 有机肥料施肥间隔（毫秒），默认 100 */
        fertilizer_interval_organic_ms: 100,
    },
    plantingStrategy: 'preferred',
    preferredSeedId: 0,
    intervals: {
        farm: 2,
        friend: 10,
        farmMin: 2,
        farmMax: 2,
        friendMin: 10,
        friendMax: 10,
    },
    friendQuietHours: {
        enabled: false,
        start: '23:00',
        end: '07:00',
    },
    friendBlacklist: [],
    /** 农场已封禁名单：访问/操作好友时若提示账号封禁则自动加入，脚本不再巡田该好友。项为 { gid, friendName? } */
    farmBannedList: [],
    stealBlacklist: [],  // 不偷取的作物 seedId 列表（偷取黑名单）
    stealDelaySeconds: 0,  // 好友作物成熟后延迟多少秒再偷取（0=不延迟）
    /** 好友操作执行顺序：['help','steal','bad'] 的排列，访问好友时按此顺序执行 帮助→偷菜→捣乱 */
    friendOpOrder: ['help', 'steal', 'bad'],
    plantOrderRandom: false,  // 自己农田种植时是否随机地块顺序
    fertilizerOrderRandom: false,  // 施肥时是否随机打乱可施肥地块顺序
    plantDelaySeconds: 0,  // 自己农田种植时每块地间隔秒数（0=使用默认50ms）
    /** 账号独立的外观：主题色 + 自定义背景图，与电脑/手机端同步 */
    ui: {
        colorTheme: 'default',
        customBackgroundUrl: '',
    },
};
const FRIEND_OP_ORDER_VALID = new Set(['help', 'steal', 'bad']);
function normalizeFriendOpOrder(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return ['help', 'steal', 'bad'];
    const seen = new Set();
    const out = [];
    for (const v of arr) {
        const key = String(v).toLowerCase();
        if (FRIEND_OP_ORDER_VALID.has(key) && !seen.has(key)) {
            seen.add(key);
            out.push(key);
        }
    }
    if (out.length !== 3) return ['help', 'steal', 'bad'];
    return out;
}
const ALLOWED_AUTOMATION_KEYS = new Set(Object.keys(DEFAULT_ACCOUNT_CONFIG.automation));

let accountFallbackConfig = {
    ...DEFAULT_ACCOUNT_CONFIG,
    automation: { ...DEFAULT_ACCOUNT_CONFIG.automation },
    intervals: { ...DEFAULT_ACCOUNT_CONFIG.intervals },
    friendQuietHours: { ...DEFAULT_ACCOUNT_CONFIG.friendQuietHours },
};

const globalConfig = {
    accountConfigs: {},
    defaultAccountConfig: cloneAccountConfig(DEFAULT_ACCOUNT_CONFIG),
    ui: {
        theme: 'dark',
        colorTheme: 'default',
    },
    offlineReminder: { ...DEFAULT_OFFLINE_REMINDER },
    adminPasswordHash: '',
};

function normalizeOfflineReminder(input) {
    const src = (input && typeof input === 'object') ? input : {};
    let offlineDeleteSec = Number.parseInt(src.offlineDeleteSec, 10);
    if (!Number.isFinite(offlineDeleteSec) || offlineDeleteSec < 1) {
        offlineDeleteSec = DEFAULT_OFFLINE_REMINDER.offlineDeleteSec;
    }
    const rawChannel = (src.channel !== undefined && src.channel !== null)
        ? String(src.channel).trim().toLowerCase()
        : '';
    const endpoint = (src.endpoint !== undefined && src.endpoint !== null)
        ? String(src.endpoint).trim()
        : DEFAULT_OFFLINE_REMINDER.endpoint;
    const migratedChannel = rawChannel
        || (PUSHOO_CHANNELS.has(String(endpoint || '').trim().toLowerCase())
            ? String(endpoint || '').trim().toLowerCase()
            : DEFAULT_OFFLINE_REMINDER.channel);
    const channel = PUSHOO_CHANNELS.has(migratedChannel)
        ? migratedChannel
        : DEFAULT_OFFLINE_REMINDER.channel;
    const rawReloginUrlMode = (src.reloginUrlMode !== undefined && src.reloginUrlMode !== null)
        ? String(src.reloginUrlMode).trim().toLowerCase()
        : DEFAULT_OFFLINE_REMINDER.reloginUrlMode;
    const reloginUrlMode = new Set(['none', 'qq_link', 'qr_link']).has(rawReloginUrlMode)
        ? rawReloginUrlMode
        : DEFAULT_OFFLINE_REMINDER.reloginUrlMode;
    const token = (src.token !== undefined && src.token !== null)
        ? String(src.token).trim()
        : DEFAULT_OFFLINE_REMINDER.token;
    const title = (src.title !== undefined && src.title !== null)
        ? String(src.title).trim()
        : DEFAULT_OFFLINE_REMINDER.title;
    const msg = (src.msg !== undefined && src.msg !== null)
        ? String(src.msg).trim()
        : DEFAULT_OFFLINE_REMINDER.msg;
    return {
        channel,
        reloginUrlMode,
        endpoint,
        token,
        title,
        msg,
        offlineDeleteSec,
    };
}

function cloneAccountConfig(base = DEFAULT_ACCOUNT_CONFIG) {
    const srcAutomation = (base && base.automation && typeof base.automation === 'object')
        ? base.automation
        : {};
    const automation = { ...DEFAULT_ACCOUNT_CONFIG.automation };
    for (const key of Object.keys(automation)) {
        if (srcAutomation[key] !== undefined) automation[key] = srcAutomation[key];
    }

    const rawBlacklist = Array.isArray(base.friendBlacklist) ? base.friendBlacklist : [];
    const rawStealBlacklist = Array.isArray(base.stealBlacklist) ? base.stealBlacklist : [];
    const rawFarmBanned = Array.isArray(base.farmBannedList) ? base.farmBannedList : [];
    const farmBannedList = rawFarmBanned.map((item) => {
        const gid = typeof item === 'object' && item && item.gid != null ? Number(item.gid) : Number(item);
        return Number.isFinite(gid) && gid > 0
            ? { gid, friendName: (typeof item === 'object' && item && typeof item.friendName === 'string') ? item.friendName : '' }
            : null;
    }).filter(Boolean);
    return {
        ...base,
        automation,
        intervals: { ...(base.intervals || DEFAULT_ACCOUNT_CONFIG.intervals) },
        friendQuietHours: { ...(base.friendQuietHours || DEFAULT_ACCOUNT_CONFIG.friendQuietHours) },
        friendBlacklist: rawBlacklist.map(Number).filter(n => Number.isFinite(n) && n > 0),
        farmBannedList,
        stealBlacklist: rawStealBlacklist.map(Number).filter(n => Number.isFinite(n) && n >= 0),
        stealDelaySeconds: Math.max(0, Math.min(300, Number(base.stealDelaySeconds) || 0)),
        friendOpOrder: normalizeFriendOpOrder(base.friendOpOrder),
        plantOrderRandom: !!(base.plantOrderRandom),
        fertilizerOrderRandom: !!(base.fertilizerOrderRandom),
        plantDelaySeconds: Math.max(0, Math.min(60, Number(base.plantDelaySeconds) || 0)),
        plantingStrategy: ALLOWED_PLANTING_STRATEGIES.includes(String(base.plantingStrategy || ''))
            ? String(base.plantingStrategy)
            : DEFAULT_ACCOUNT_CONFIG.plantingStrategy,
        preferredSeedId: Math.max(0, Number.parseInt(base.preferredSeedId, 10) || 0),
        ui: {
            colorTheme: String((base.ui && base.ui.colorTheme) || 'default').trim() || 'default',
            customBackgroundUrl: String((base.ui && base.ui.customBackgroundUrl) || '').trim(),
        },
    };
}

function resolveAccountId(accountId) {
    const direct = (accountId !== undefined && accountId !== null) ? String(accountId).trim() : '';
    if (direct) return direct;
    const envId = String(process.env.FARM_ACCOUNT_ID || '').trim();
    return envId;
}

function normalizeAccountConfig(input, fallback = accountFallbackConfig) {
    const src = (input && typeof input === 'object') ? input : {};
    const cfg = cloneAccountConfig(fallback || DEFAULT_ACCOUNT_CONFIG);

    if (src.automation && typeof src.automation === 'object') {
        for (const [k, v] of Object.entries(src.automation)) {
            if (!ALLOWED_AUTOMATION_KEYS.has(k)) continue;
            if (k === 'fertilizer') {
                const allowed = ['both', 'normal', 'organic', 'none'];
                cfg.automation[k] = allowed.includes(v) ? v : cfg.automation[k];
            } else if (k === 'fertilizer_interval_normal_ms' || k === 'fertilizer_interval_organic_ms') {
                const def = k === 'fertilizer_interval_normal_ms' ? 50 : 100;
                const num = Math.max(0, Math.min(60000, Number.parseInt(v, 10) || def));
                cfg.automation[k] = num;
            } else if (k === 'farm_fertilizer_anti_steal_sec') {
                const num = Math.max(0, Math.min(86400, Number.parseInt(v, 10) || 300));
                cfg.automation[k] = num;
            } else {
                cfg.automation[k] = !!v;
            }
        }
        // 旧配置兼容：friend_help → friend_water / friend_weed / friend_bug
        if (src.automation.friend_help !== undefined
            && src.automation.friend_water === undefined
            && src.automation.friend_weed === undefined
            && src.automation.friend_bug === undefined) {
            const helpVal = !!src.automation.friend_help;
            cfg.automation.friend_water = helpVal;
            cfg.automation.friend_weed = helpVal;
            cfg.automation.friend_bug = helpVal;
        }
    }

    if (src.plantingStrategy && ALLOWED_PLANTING_STRATEGIES.includes(src.plantingStrategy)) {
        cfg.plantingStrategy = src.plantingStrategy;
    }

    if (src.preferredSeedId !== undefined && src.preferredSeedId !== null) {
        cfg.preferredSeedId = Math.max(0, Number.parseInt(src.preferredSeedId, 10) || 0);
    }

    if (src.intervals && typeof src.intervals === 'object') {
        for (const [type, sec] of Object.entries(src.intervals)) {
            if (cfg.intervals[type] === undefined) continue;
            cfg.intervals[type] = Math.max(1, Number.parseInt(sec, 10) || cfg.intervals[type] || 1);
        }
        cfg.intervals = normalizeIntervals(cfg.intervals);
    } else {
        cfg.intervals = normalizeIntervals(cfg.intervals);
    }

    if (src.friendQuietHours && typeof src.friendQuietHours === 'object') {
        const old = cfg.friendQuietHours || {};
        cfg.friendQuietHours = {
            enabled: src.friendQuietHours.enabled !== undefined ? !!src.friendQuietHours.enabled : !!old.enabled,
            start: normalizeTimeString(src.friendQuietHours.start, old.start || '23:00'),
            end: normalizeTimeString(src.friendQuietHours.end, old.end || '07:00'),
        };
    }

    if (Array.isArray(src.friendBlacklist)) {
        cfg.friendBlacklist = src.friendBlacklist.map(Number).filter(n => Number.isFinite(n) && n > 0);
    }

    if (Array.isArray(src.farmBannedList)) {
        cfg.farmBannedList = src.farmBannedList.map((item) => {
            const gid = typeof item === 'object' && item && item.gid != null ? Number(item.gid) : Number(item);
            return Number.isFinite(gid) && gid > 0
                ? { gid, friendName: (typeof item === 'object' && item && typeof item.friendName === 'string') ? item.friendName : '' }
                : null;
        }).filter(Boolean);
    }

    if (Array.isArray(src.stealBlacklist)) {
        cfg.stealBlacklist = src.stealBlacklist.map(Number).filter(n => Number.isFinite(n) && n >= 0);
    }

    if (src.stealDelaySeconds !== undefined && src.stealDelaySeconds !== null) {
        const v = Math.max(0, Math.min(300, Number.parseInt(src.stealDelaySeconds, 10) || 0));
        cfg.stealDelaySeconds = v;
    }

    if (Array.isArray(src.friendOpOrder)) {
        cfg.friendOpOrder = normalizeFriendOpOrder(src.friendOpOrder);
    }

    if (src.plantOrderRandom !== undefined && src.plantOrderRandom !== null) {
        cfg.plantOrderRandom = !!src.plantOrderRandom;
    }

    if (src.fertilizerOrderRandom !== undefined && src.fertilizerOrderRandom !== null) {
        cfg.fertilizerOrderRandom = !!src.fertilizerOrderRandom;
    }

    if (src.plantDelaySeconds !== undefined && src.plantDelaySeconds !== null) {
        cfg.plantDelaySeconds = Math.max(0, Math.min(60, Number(src.plantDelaySeconds) || 0));
    }

    if (src.ui && typeof src.ui === 'object') {
        cfg.ui = cfg.ui || { colorTheme: 'default', customBackgroundUrl: '' };
        if (src.ui.colorTheme !== undefined && src.ui.colorTheme !== null) {
            const v = String(src.ui.colorTheme).trim();
            if (v) cfg.ui.colorTheme = v;
        }
        if (src.ui.customBackgroundUrl !== undefined) {
            cfg.ui.customBackgroundUrl = String(src.ui.customBackgroundUrl || '').trim();
        }
    }

    return cfg;
}

function getAccountConfigSnapshot(accountId) {
    const id = resolveAccountId(accountId);
    if (!id) return cloneAccountConfig(accountFallbackConfig);
    return normalizeAccountConfig(globalConfig.accountConfigs[id], accountFallbackConfig);
}

function setAccountConfigSnapshot(accountId, nextConfig, persist = true) {
    const id = resolveAccountId(accountId);
    if (!id) {
        accountFallbackConfig = normalizeAccountConfig(nextConfig, accountFallbackConfig);
        globalConfig.defaultAccountConfig = cloneAccountConfig(accountFallbackConfig);
        if (persist) saveGlobalConfig();
        return cloneAccountConfig(accountFallbackConfig);
    }
    globalConfig.accountConfigs[id] = normalizeAccountConfig(nextConfig, accountFallbackConfig);
    if (persist) saveGlobalConfig();
    return cloneAccountConfig(globalConfig.accountConfigs[id]);
}

function removeAccountConfig(accountId) {
    const id = resolveAccountId(accountId);
    if (!id) return;
    if (globalConfig.accountConfigs[id]) {
        delete globalConfig.accountConfigs[id];
        saveGlobalConfig();
    }
}

function ensureAccountConfig(accountId, options = {}) {
    const id = resolveAccountId(accountId);
    if (!id) return null;
    if (globalConfig.accountConfigs[id]) {
        return cloneAccountConfig(globalConfig.accountConfigs[id]);
    }
    globalConfig.accountConfigs[id] = normalizeAccountConfig(globalConfig.defaultAccountConfig, accountFallbackConfig);
    // 新账号默认不施肥（不受历史 defaultAccountConfig 旧值影响）
    if (globalConfig.accountConfigs[id] && globalConfig.accountConfigs[id].automation) {
        globalConfig.accountConfigs[id].automation.fertilizer = 'none';
    }
    if (options.persist !== false) saveGlobalConfig();
    return cloneAccountConfig(globalConfig.accountConfigs[id]);
}

// 加载全局配置
function loadGlobalConfig() {
    ensureDataDir();
    try {
        const data = readJsonFile(STORE_FILE, () => ({}));
        if (data && typeof data === 'object') {
            if (data.defaultAccountConfig && typeof data.defaultAccountConfig === 'object') {
                accountFallbackConfig = normalizeAccountConfig(data.defaultAccountConfig, DEFAULT_ACCOUNT_CONFIG);
            } else {
                accountFallbackConfig = cloneAccountConfig(DEFAULT_ACCOUNT_CONFIG);
            }
            globalConfig.defaultAccountConfig = cloneAccountConfig(accountFallbackConfig);

            const cfgMap = (data.accountConfigs && typeof data.accountConfigs === 'object')
                ? data.accountConfigs
                : {};
            globalConfig.accountConfigs = {};
            for (const [id, cfg] of Object.entries(cfgMap)) {
                const sid = String(id || '').trim();
                if (!sid) continue;
                globalConfig.accountConfigs[sid] = normalizeAccountConfig(cfg, accountFallbackConfig);
            }
            // 统一规范化，确保内存中不残留旧字段（如 automation.friend）
            globalConfig.defaultAccountConfig = cloneAccountConfig(accountFallbackConfig);
            for (const [id, cfg] of Object.entries(globalConfig.accountConfigs)) {
                globalConfig.accountConfigs[id] = normalizeAccountConfig(cfg, accountFallbackConfig);
            }
            globalConfig.ui = { ...globalConfig.ui, ...(data.ui || {}) };
            const theme = String(globalConfig.ui.theme || '').toLowerCase();
            globalConfig.ui.theme = theme === 'light' ? 'light' : 'dark';
            globalConfig.ui.colorTheme = String(globalConfig.ui.colorTheme || 'default');
            globalConfig.offlineReminder = normalizeOfflineReminder(data.offlineReminder);
            if (typeof data.adminPasswordHash === 'string') {
                globalConfig.adminPasswordHash = data.adminPasswordHash;
            }
        }
    } catch (e) {
        console.error('加载配置失败:', e.message);
    }
}

function sanitizeGlobalConfigBeforeSave() {
    // default 配置统一白名单净化
    accountFallbackConfig = normalizeAccountConfig(globalConfig.defaultAccountConfig, DEFAULT_ACCOUNT_CONFIG);
    globalConfig.defaultAccountConfig = cloneAccountConfig(accountFallbackConfig);

    // 每个账号配置也统一净化
    const map = (globalConfig.accountConfigs && typeof globalConfig.accountConfigs === 'object')
        ? globalConfig.accountConfigs
        : {};
    const nextMap = {};
    for (const [id, cfg] of Object.entries(map)) {
        const sid = String(id || '').trim();
        if (!sid) continue;
        nextMap[sid] = normalizeAccountConfig(cfg, accountFallbackConfig);
    }
    globalConfig.accountConfigs = nextMap;
}

// 保存全局配置
function saveGlobalConfig() {
    ensureDataDir();
    try {
        const oldJson = readTextFile(STORE_FILE, '');

        sanitizeGlobalConfigBeforeSave();
        const newJson = JSON.stringify(globalConfig, null, 2);
        
        if (oldJson !== newJson) {
            console.warn('[系统] 正在保存配置到:', STORE_FILE);
            writeJsonFileAtomic(STORE_FILE, globalConfig);
        }
    } catch (e) {
        console.error('保存配置失败:', e.message);
    }
}

function getAdminPasswordHash() {
    return String(globalConfig.adminPasswordHash || '');
}

function setAdminPasswordHash(hash) {
    globalConfig.adminPasswordHash = String(hash || '');
    saveGlobalConfig();
    return globalConfig.adminPasswordHash;
}

// 初始化加载
loadGlobalConfig();

function getAutomation(accountId) {
    return { ...getAccountConfigSnapshot(accountId).automation };
}

function getConfigSnapshot(accountId) {
    const cfg = getAccountConfigSnapshot(accountId);
    return {
        automation: { ...cfg.automation },
        plantingStrategy: cfg.plantingStrategy,
        preferredSeedId: cfg.preferredSeedId,
        intervals: { ...cfg.intervals },
        friendQuietHours: { ...cfg.friendQuietHours },
        friendBlacklist: [...(cfg.friendBlacklist || [])],
        farmBannedList: Array.isArray(cfg.farmBannedList) ? cfg.farmBannedList.map((x) => ({ gid: x.gid, friendName: x.friendName || '' })) : [],
        stealBlacklist: [...(cfg.stealBlacklist || [])],
        stealDelaySeconds: Math.max(0, Math.min(300, Number(cfg.stealDelaySeconds) || 0)),
        friendOpOrder: normalizeFriendOpOrder(cfg.friendOpOrder),
        plantOrderRandom: !!cfg.plantOrderRandom,
        plantDelaySeconds: Math.max(0, Math.min(60, Number(cfg.plantDelaySeconds) || 0)),
        ui: getUIForAccount(accountId),
    };
}

function setAccountUI(accountId, updates) {
    if (!updates || typeof updates !== 'object') return getUIForAccount(accountId);
    const id = resolveAccountId(accountId);
    if (!id) return getUIForAccount(accountId);
    const current = getAccountConfigSnapshot(id);
    const next = { ...current, ui: { ...(current.ui || {}), ...updates } };
    if (next.ui.colorTheme && !VALID_COLOR_THEMES.has(String(next.ui.colorTheme).trim())) {
        next.ui.colorTheme = 'default';
    }
    setAccountConfigSnapshot(id, next);
    return getUIForAccount(id);
}

function applyConfigSnapshot(snapshot, options = {}) {
    const cfg = snapshot || {};
    const persist = options.persist !== false;
    const accountId = options.accountId;

    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, accountFallbackConfig);

    if (cfg.automation && typeof cfg.automation === 'object') {
        for (const [k, v] of Object.entries(cfg.automation)) {
            if (next.automation[k] === undefined) continue;
            if (k === 'fertilizer') {
                const allowed = ['both', 'normal', 'organic', 'none'];
                next.automation[k] = allowed.includes(v) ? v : next.automation[k];
            } else if (k === 'fertilizer_interval_normal_ms' || k === 'fertilizer_interval_organic_ms') {
                const def = k === 'fertilizer_interval_normal_ms' ? 50 : 100;
                const num = Math.max(0, Math.min(60000, Number.parseInt(v, 10) || def));
                next.automation[k] = num;
            } else if (k === 'farm_fertilizer_anti_steal_sec') {
                const num = Math.max(0, Math.min(86400, Number.parseInt(v, 10) || 300));
                next.automation[k] = num;
            } else {
                next.automation[k] = !!v;
            }
        }
    }

    if (cfg.plantingStrategy && ALLOWED_PLANTING_STRATEGIES.includes(cfg.plantingStrategy)) {
        next.plantingStrategy = cfg.plantingStrategy;
    }

    if (cfg.preferredSeedId !== undefined && cfg.preferredSeedId !== null) {
        next.preferredSeedId = Math.max(0, Number.parseInt(cfg.preferredSeedId, 10) || 0);
    }

    if (cfg.intervals && typeof cfg.intervals === 'object') {
        for (const [type, sec] of Object.entries(cfg.intervals)) {
            if (next.intervals[type] === undefined) continue;
            next.intervals[type] = Math.max(1, Number.parseInt(sec, 10) || next.intervals[type] || 1);
        }
        next.intervals = normalizeIntervals(next.intervals);
    }

    if (cfg.friendQuietHours && typeof cfg.friendQuietHours === 'object') {
        const old = next.friendQuietHours || {};
        next.friendQuietHours = {
            enabled: cfg.friendQuietHours.enabled !== undefined ? !!cfg.friendQuietHours.enabled : !!old.enabled,
            start: normalizeTimeString(cfg.friendQuietHours.start, old.start || '23:00'),
            end: normalizeTimeString(cfg.friendQuietHours.end, old.end || '07:00'),
        };
    }

    if (Array.isArray(cfg.friendBlacklist)) {
        next.friendBlacklist = cfg.friendBlacklist.map(Number).filter(n => Number.isFinite(n) && n > 0);
    }

    if (Array.isArray(cfg.farmBannedList)) {
        next.farmBannedList = cfg.farmBannedList.map((item) => {
            const gid = typeof item === 'object' && item && item.gid != null ? Number(item.gid) : Number(item);
            return Number.isFinite(gid) && gid > 0
                ? { gid, friendName: (typeof item === 'object' && item && typeof item.friendName === 'string') ? item.friendName : '' }
                : null;
        }).filter(Boolean);
    }

    if (Array.isArray(cfg.stealBlacklist)) {
        next.stealBlacklist = cfg.stealBlacklist.map(Number).filter(n => Number.isFinite(n) && n >= 0);
    }

    if (cfg.stealDelaySeconds !== undefined && cfg.stealDelaySeconds !== null) {
        next.stealDelaySeconds = Math.max(0, Math.min(300, Number(cfg.stealDelaySeconds) || 0));
    }

    if (Array.isArray(cfg.friendOpOrder)) {
        next.friendOpOrder = normalizeFriendOpOrder(cfg.friendOpOrder);
    }

    if (cfg.plantOrderRandom !== undefined && cfg.plantOrderRandom !== null) {
        next.plantOrderRandom = !!cfg.plantOrderRandom;
    }

    if (cfg.fertilizerOrderRandom !== undefined && cfg.fertilizerOrderRandom !== null) {
        next.fertilizerOrderRandom = !!cfg.fertilizerOrderRandom;
    }

    if (cfg.plantDelaySeconds !== undefined && cfg.plantDelaySeconds !== null) {
        next.plantDelaySeconds = Math.max(0, Math.min(60, Number(cfg.plantDelaySeconds) || 0));
    }

    if (cfg.ui && typeof cfg.ui === 'object') {
        const theme = String(cfg.ui.theme || '').toLowerCase();
        if (theme === 'dark' || theme === 'light') {
            globalConfig.ui.theme = theme;
        }
        next.ui = next.ui || { colorTheme: 'default', customBackgroundUrl: '' };
        if (cfg.ui.colorTheme !== undefined) {
            const v = String(cfg.ui.colorTheme || 'default').trim() || 'default';
            next.ui.colorTheme = VALID_COLOR_THEMES.has(v) ? v : 'default';
        }
        if (cfg.ui.customBackgroundUrl !== undefined) {
            next.ui.customBackgroundUrl = String(cfg.ui.customBackgroundUrl || '').trim();
        }
    }

    setAccountConfigSnapshot(accountId, next, false);
    if (persist) saveGlobalConfig();
    // 用已计算的 next 构造返回值，避免再次调用 getAccountConfigSnapshot
    return {
        automation: { ...next.automation },
        plantingStrategy: next.plantingStrategy,
        preferredSeedId: next.preferredSeedId,
        intervals: { ...next.intervals },
        friendQuietHours: { ...next.friendQuietHours },
        friendBlacklist: [...(next.friendBlacklist || [])],
        farmBannedList: Array.isArray(next.farmBannedList) ? next.farmBannedList.map((x) => ({ gid: x.gid, friendName: x.friendName || '' })) : [],
        stealBlacklist: [...(next.stealBlacklist || [])],
        stealDelaySeconds: Math.max(0, Math.min(300, Number(next.stealDelaySeconds) || 0)),
        friendOpOrder: [...(normalizeFriendOpOrder(next.friendOpOrder))],
        plantOrderRandom: !!next.plantOrderRandom,
        fertilizerOrderRandom: !!next.fertilizerOrderRandom,
        plantDelaySeconds: Math.max(0, Math.min(60, Number(next.plantDelaySeconds) || 0)),
        ui: { ...globalConfig.ui },
    };
}

function setAutomation(key, value, accountId) {
    return applyConfigSnapshot({ automation: { [key]: value } }, { accountId });
}

function isAutomationOn(key, accountId) {
    return !!getAccountConfigSnapshot(accountId).automation[key];
}

function getPreferredSeed(accountId) {
    return getAccountConfigSnapshot(accountId).preferredSeedId;
}

function getPlantingStrategy(accountId) {
    return getAccountConfigSnapshot(accountId).plantingStrategy;
}

function getStealDelaySeconds(accountId) {
    return Math.max(0, Math.min(300, Number(getAccountConfigSnapshot(accountId).stealDelaySeconds) || 0));
}

function getFriendOpOrder(accountId) {
    const raw = getAccountConfigSnapshot(accountId).friendOpOrder;
    return normalizeFriendOpOrder(raw);
}

function getPlantOrderRandom(accountId) {
    return !!getAccountConfigSnapshot(accountId).plantOrderRandom;
}

function getFertilizerOrderRandom(accountId) {
    return !!getAccountConfigSnapshot(accountId).fertilizerOrderRandom;
}

function getPlantDelaySeconds(accountId) {
    return Math.max(0, Math.min(60, Number(getAccountConfigSnapshot(accountId).plantDelaySeconds) || 0));
}

function getIntervals(accountId) {
    return { ...getAccountConfigSnapshot(accountId).intervals };
}

function normalizeIntervals(intervals) {
    const src = (intervals && typeof intervals === 'object') ? intervals : {};
    const toSec = (v, d) => Math.max(1, Number.parseInt(v, 10) || d);
    const farm = toSec(src.farm, 2);
    const friend = toSec(src.friend, 10);

    let farmMin = toSec(src.farmMin, farm);
    let farmMax = toSec(src.farmMax, farm);
    if (farmMin > farmMax) [farmMin, farmMax] = [farmMax, farmMin];

    let friendMin = toSec(src.friendMin, friend);
    let friendMax = toSec(src.friendMax, friend);
    if (friendMin > friendMax) [friendMin, friendMax] = [friendMax, friendMin];

    return {
        ...src,
        farm,
        friend,
        farmMin,
        farmMax,
        friendMin,
        friendMax,
    };
}

function normalizeTimeString(v, fallback) {
    const s = String(v || '').trim();
    const m = s.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!m) return fallback;
    const hh = Math.max(0, Math.min(23, Number.parseInt(m[1], 10)));
    const mm = Math.max(0, Math.min(59, Number.parseInt(m[2], 10)));
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function getFriendQuietHours(accountId) {
    return { ...getAccountConfigSnapshot(accountId).friendQuietHours };
}

function getFriendBlacklist(accountId) {
    return [...(getAccountConfigSnapshot(accountId).friendBlacklist || [])];
}

function setFriendBlacklist(accountId, list) {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, accountFallbackConfig);
    next.friendBlacklist = Array.isArray(list) ? list.map(Number).filter(n => Number.isFinite(n) && n > 0) : [];
    setAccountConfigSnapshot(accountId, next);
    return [...next.friendBlacklist];
}

function getFarmBannedList(accountId) {
    const list = getAccountConfigSnapshot(accountId).farmBannedList || [];
    return list.map((x) => ({ gid: x.gid, friendName: x.friendName || '' }));
}

function addToFarmBanned(accountId, gid, friendName) {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, accountFallbackConfig);
    const list = Array.isArray(next.farmBannedList) ? next.farmBannedList : [];
    const numGid = Number(gid);
    if (!Number.isFinite(numGid) || numGid <= 0) return list;
    if (list.some((x) => x.gid === numGid)) return list;
    next.farmBannedList = [...list, { gid: numGid, friendName: typeof friendName === 'string' ? friendName : '' }];
    setAccountConfigSnapshot(accountId, next);
    return [...next.farmBannedList];
}

function removeFromFarmBanned(accountId, gid) {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, accountFallbackConfig);
    const list = Array.isArray(next.farmBannedList) ? next.farmBannedList : [];
    const numGid = Number(gid);
    next.farmBannedList = list.filter((x) => x.gid !== numGid);
    setAccountConfigSnapshot(accountId, next);
    return [...next.farmBannedList];
}

function getStealBlacklist(accountId) {
    return [...(getAccountConfigSnapshot(accountId).stealBlacklist || [])];
}

function setStealBlacklist(accountId, list) {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, accountFallbackConfig);
    next.stealBlacklist = Array.isArray(list) ? list.map(Number).filter(n => Number.isFinite(n) && n >= 0) : [];
    setAccountConfigSnapshot(accountId, next);
    return [...next.stealBlacklist];
}

const VALID_COLOR_THEMES = new Set(['default', 'ocean', 'sunset', 'amethyst', 'sakura']);

/** 按账号获取 UI 配置（主题 + 自定义背景），无 accountId 时返回全局默认 */
function getUIForAccount(accountId) {
    const id = resolveAccountId(accountId);
    if (!id) {
        return {
            colorTheme: String(globalConfig.ui?.colorTheme || 'default'),
            customBackgroundUrl: String(globalConfig.ui?.customBackgroundUrl || ''),
        };
    }
    const cfg = getAccountConfigSnapshot(id);
    const ui = (cfg && cfg.ui && typeof cfg.ui === 'object') ? cfg.ui : {};
    return {
        colorTheme: VALID_COLOR_THEMES.has(String(ui.colorTheme || '').trim()) ? String(ui.colorTheme).trim() : 'default',
        customBackgroundUrl: String(ui.customBackgroundUrl || '').trim(),
    };
}

function getUI(accountId) {
    return getUIForAccount(accountId);
}

function setUITheme(theme) {
    const t = String(theme || '').toLowerCase();
    const next = (t === 'light') ? 'light' : 'dark';
    return applyConfigSnapshot({ ui: { theme: next } });
}

function setUIColorTheme(colorTheme) {
    globalConfig.ui.colorTheme = String(colorTheme || 'default');
    saveGlobalConfig();
    return { ...globalConfig.ui };
}

function getOfflineReminder() {
    return normalizeOfflineReminder(globalConfig.offlineReminder);
}

function setOfflineReminder(cfg) {
    const current = normalizeOfflineReminder(globalConfig.offlineReminder);
    globalConfig.offlineReminder = normalizeOfflineReminder({ ...current, ...(cfg || {}) });
    saveGlobalConfig();
    return getOfflineReminder();
}

// ============ 账号管理 ============
function loadAccounts() {
    ensureDataDir();
    const data = readJsonFile(ACCOUNTS_FILE, () => ({ accounts: [], nextId: 1 }));
    return normalizeAccountsData(data);
}

function saveAccounts(data) {
    ensureDataDir();
    writeJsonFileAtomic(ACCOUNTS_FILE, normalizeAccountsData(data));
}

function getAccounts() {
    return loadAccounts();
}

/** 按登录用户过滤账号：仅返回属于该用户的账号。legacy-admin 视为无 ownerId 或 ownerId 为 legacy-admin 的账号 */
function getAccountsByOwner(userId) {
    const { accounts } = loadAccounts();
    if (!userId) return { accounts: [] };
    const uid = String(userId);
    if (uid === 'legacy-admin') {
        const list = accounts.filter(a => !a.ownerId || a.ownerId === 'legacy-admin');
        return { accounts: list };
    }
    return { accounts: accounts.filter(a => String(a.ownerId || '') === uid) };
}

function normalizeAccountsData(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const accounts = Array.isArray(data.accounts) ? data.accounts : [];
    const maxId = accounts.reduce((m, a) => Math.max(m, Number.parseInt(a && a.id, 10) || 0), 0);
    let nextId = Number.parseInt(data.nextId, 10);
    if (!Number.isFinite(nextId) || nextId <= 0) nextId = maxId + 1;
    if (accounts.length === 0) nextId = 1;
    if (nextId <= maxId) nextId = maxId + 1;
    return { accounts, nextId };
}

function addOrUpdateAccount(acc) {
    const data = normalizeAccountsData(loadAccounts());
    let touchedAccountId = '';
    const normUin = (v) => (v != null && v !== '') ? String(v).trim() : '';
    const uinFromAcc = normUin(acc.uin || acc.qq);

    if (acc.id) {
        const idx = data.accounts.findIndex(a => a.id === acc.id);
        if (idx >= 0) {
            const { ownerId: _drop, ...rest } = acc;
            data.accounts[idx] = { ...data.accounts[idx], ...rest, name: acc.name !== undefined ? acc.name : data.accounts[idx].name, updatedAt: Date.now() };
            touchedAccountId = String(data.accounts[idx].id || '');
        }
    } else {
        // 新增时：若已存在相同 uin/qq 的账号，则复用该条并更新归属与信息，避免重复记录
        const existingIdx = uinFromAcc
            ? data.accounts.findIndex(a => normUin(a.uin || a.qq) === uinFromAcc)
            : -1;
        if (existingIdx >= 0) {
            const existing = data.accounts[existingIdx];
            touchedAccountId = String(existing.id || '');
            const updated = {
                ...existing,
                name: acc.name !== undefined && acc.name !== '' ? String(acc.name).trim() : existing.name,
                code: acc.code !== undefined ? String(acc.code || '') : existing.code,
                platform: acc.platform || existing.platform || 'qq',
                uin: uinFromAcc || existing.uin || '',
                qq: uinFromAcc || existing.qq || existing.uin || '',
                avatar: acc.avatar !== undefined || acc.avatarUrl !== undefined ? String(acc.avatar || acc.avatarUrl || '').trim() : existing.avatar,
                ownerId: acc.ownerId != null ? String(acc.ownerId) : existing.ownerId,
                updatedAt: Date.now(),
            };
            data.accounts[existingIdx] = updated;
            data.accounts.splice(existingIdx, 1);
            data.accounts.push(updated);
        } else {
            const id = data.nextId++;
            touchedAccountId = String(id);
            data.accounts.push({
                id: touchedAccountId,
                name: acc.name || `账号${id}`,
                code: acc.code || '',
                platform: acc.platform || 'qq',
                uin: uinFromAcc,
                qq: uinFromAcc,
                avatar: acc.avatar || acc.avatarUrl || '',
                ownerId: acc.ownerId != null ? String(acc.ownerId) : undefined,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
        }
    }
    saveAccounts(data);
    if (touchedAccountId) {
        ensureAccountConfig(touchedAccountId);
    }
    return data;
}

function deleteAccount(id) {
    const data = normalizeAccountsData(loadAccounts());
    data.accounts = data.accounts.filter(a => a.id !== String(id));
    if (data.accounts.length === 0) {
        data.nextId = 1;
    }
    saveAccounts(data);
    removeAccountConfig(id);
    return data;
}

/** 设置账号的网页登录权限（封号时禁止登录）：true=禁止，false=允许 */
function setAccountLoginDisabled(accountId, disabled) {
    const data = normalizeAccountsData(loadAccounts());
    const idx = data.accounts.findIndex(a => String(a.id) === String(accountId));
    if (idx < 0) return false;
    data.accounts[idx] = { ...data.accounts[idx], loginDisabled: !!disabled, updatedAt: Date.now() };
    saveAccounts(data);
    return true;
}

module.exports = {
    getConfigSnapshot,
    applyConfigSnapshot,
    getAutomation,
    setAutomation,
    isAutomationOn,
    getPreferredSeed,
    getPlantingStrategy,
    getIntervals,
    getFriendQuietHours,
    getFriendBlacklist,
    setFriendBlacklist,
    getFarmBannedList,
    addToFarmBanned,
    removeFromFarmBanned,
    getStealBlacklist,
    setStealBlacklist,
    getStealDelaySeconds,
    getFriendOpOrder,
    getPlantOrderRandom,
    getFertilizerOrderRandom,
    getPlantDelaySeconds,
    getUI,
    getUIForAccount,
    setUITheme,
    setUIColorTheme,
    setAccountUI,
    getOfflineReminder,
    setOfflineReminder,
    getAccounts,
    getAccountsByOwner,
    addOrUpdateAccount,
    deleteAccount,
    setAccountLoginDisabled,
    getAdminPasswordHash,
    setAdminPasswordHash,
};
