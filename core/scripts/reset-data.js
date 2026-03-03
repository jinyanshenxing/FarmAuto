/**
 * 重置项目数据为干净状态：清空账号、卡密、用户、配置及日志
 * 用于部署前清理，保证交付为干净项目。
 * 运行方式（在项目根目录）：node core/scripts/reset-data.js
 */

const fs = require('node:fs');
const path = require('node:path');

const coreRoot = path.join(__dirname, '..');
const dataDir = path.join(coreRoot, 'data');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

const DEFAULT_OFFLINE_REMINDER = {
    channel: 'webhook',
    reloginUrlMode: 'none',
    endpoint: '',
    token: '',
    title: '账号下线提醒',
    msg: '账号下线',
    offlineDeleteSec: 120,
};

const DEFAULT_ACCOUNT_CONFIG = {
    automation: {
        farm: true,
        farm_push: true,
        land_upgrade: true,
        farm_water: true,
        farm_weed: true,
        farm_bug: true,
        friend: true,
        friend_help_exp_limit: true,
        friend_steal: true,
        friend_water: true,
        friend_weed: true,
        friend_bug: true,
        friend_bad: false,
        task: true,
        email: true,
        fertilizer_gift: false,
        fertilizer_buy: false,
        farm_fertilizer_normal: true,
        farm_fertilizer_organic_once: false,
        farm_fertilizer_anti_steal: false,
        farm_fertilizer_anti_steal_sec: 300,
        farm_fertilizer_organic_loop: false,
        farm_fertilizer_use_gift_pack: true,
        free_gifts: true,
        share_reward: true,
        vip_gift: true,
        month_card: true,
        open_server_gift: true,
        sell: false,
        fertilizer: 'none',
    },
    plantingStrategy: 'preferred',
    preferredSeedId: 0,
    intervals: { farm: 2, friend: 10, farmMin: 2, farmMax: 2, friendMin: 10, friendMax: 10 },
    friendQuietHours: { enabled: false, start: '23:00', end: '07:00' },
    friendBlacklist: [],
    farmBannedList: [],
    stealBlacklist: [],
    stealDelaySeconds: 0,
    friendOpOrder: ['help', 'steal', 'bad'],
    plantOrderRandom: false,
    fertilizerOrderRandom: false,
    plantDelaySeconds: 0,
    ui: { colorTheme: 'default', customBackgroundUrl: '' },
};

const cleanStore = {
    accountConfigs: {},
    defaultAccountConfig: DEFAULT_ACCOUNT_CONFIG,
    ui: { theme: 'dark', colorTheme: 'default' },
    offlineReminder: DEFAULT_OFFLINE_REMINDER,
    adminPasswordHash: '',
};

function main() {
    ensureDir(dataDir);

    const accountsFile = path.join(dataDir, 'accounts.json');
    const cardsFile = path.join(dataDir, 'cards.json');
    const usersFile = path.join(dataDir, 'users.json');
    const storeFile = path.join(dataDir, 'store.json');
    const logsDir = path.join(dataDir, 'logs');

    writeJson(accountsFile, { accounts: [], nextId: 1 });
    console.log('已重置:', accountsFile);

    writeJson(cardsFile, { cards: [], nextId: 1 });
    console.log('已重置:', cardsFile);

    writeJson(usersFile, { users: [], nextId: 1 });
    console.log('已重置:', usersFile);

    writeJson(storeFile, cleanStore);
    console.log('已重置:', storeFile);

    if (fs.existsSync(logsDir)) {
        const files = fs.readdirSync(logsDir);
        for (const f of files) {
            const full = path.join(logsDir, f);
            if (fs.statSync(full).isFile()) {
                fs.unlinkSync(full);
                console.log('已删除日志:', full);
            }
        }
    }

    const shareFile = path.join(coreRoot, 'share.txt');
    if (fs.existsSync(shareFile)) {
        fs.writeFileSync(shareFile, '', 'utf8');
        console.log('已清空:', shareFile);
    }

    console.log('数据已清理完毕，当前为干净项目状态。');
}

main();
