const crypto = require('node:crypto');
/**
 * 管理面板 HTTP 服务
 * 改写为接收 DataProvider 模式
 */

const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const express = require('express');
const { Server: SocketIOServer } = require('socket.io');
const { version } = require('../../package.json');
const { CONFIG } = require('../config/config');
const { getLevelExpProgress } = require('../config/gameConfig');
const { getResourcePath } = require('../config/runtime-paths');
const store = require('../models/store');
const cardsModel = require('../models/cards');
const usersModel = require('../models/users');
const { addOrUpdateAccount, deleteAccount, getAccountsByOwner, setAccountLoginDisabled } = store;
const { findAccountByRef, normalizeAccountRef, resolveAccountId } = require('../services/account-resolver');
const { createModuleLogger } = require('../services/logger');
const { MiniProgramLoginSession } = require('../services/qrlogin');
const { getSchedulerRegistrySnapshot } = require('../services/scheduler');

const hashPassword = (pwd) => crypto.createHash('sha256').update(String(pwd || '')).digest('hex');
const adminLogger = createModuleLogger('admin');

let app = null;
let server = null;
let provider = null; // DataProvider
let io = null;
/** 在 startAdminServer 内注入：用于按用户过滤日志推送 */
let getAccountListForUserRef = null;

function emitRealtimeStatusToOwners(accountId, status) {
    if (!io || !getAccountListForUserRef) return;
    const id = String(accountId || '').trim();
    if (!id) return;
    const payload = { accountId: id, status };
    for (const [, s] of io.sockets.sockets) {
        const uid = s.data.userId;
        if (!uid) continue;
        const list = getAccountListForUserRef(uid);
        const owns = (Array.isArray(list) ? list : []).some(a => String(a.id) === id);
        if (!owns) continue;
        const inRoom = s.rooms.has(`account:${id}`) || s.rooms.has('account:all');
        if (inRoom) s.emit('status:update', payload);
    }
}

function emitRealtimeStatus(accountId, status) {
    emitRealtimeStatusToOwners(accountId, status);
}

function emitRealtimeLogToAllOwners(io, id, payload, eventName) {
    if (!io || !id || !getAccountListForUserRef) return;
    for (const [sid, s] of io.sockets.sockets) {
        if (!s.rooms.has('account:all') || s.rooms.has(`account:${id}`)) continue;
        const uid = s.data.userId;
        if (!uid) continue;
        const list = getAccountListForUserRef(uid);
        if ((Array.isArray(list) ? list : []).some(a => String(a.id) === id))
            s.emit(eventName, payload);
    }
}

function emitRealtimeLog(entry) {
    if (!io) return;
    const payload = (entry && typeof entry === 'object') ? entry : {};
    const id = String(payload.accountId || '').trim();
    if (id) io.to(`account:${id}`).emit('log:new', payload);
    emitRealtimeLogToAllOwners(io, id, payload, 'log:new');
}

function emitRealtimeAccountLog(entry) {
    if (!io) return;
    const payload = (entry && typeof entry === 'object') ? entry : {};
    const id = String(payload.accountId || '').trim();
    if (id) io.to(`account:${id}`).emit('account-log:new', payload);
    emitRealtimeLogToAllOwners(io, id, payload, 'account-log:new');
}

function startAdminServer(dataProvider) {
    if (app) return;
    provider = dataProvider;

    app = express();
    app.use(express.json());

    // token -> { userId, username, role }，兼容管理员与普通用户
    const tokenData = new Map();

    const issueToken = () => crypto.randomBytes(24).toString('hex');
    const authRequired = (req, res, next) => {
        const token = req.headers['x-admin-token'];
        if (!token || !tokenData.has(token)) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }
        req.adminToken = token;
        req.tokenUser = tokenData.get(token);
        next();
    };

    const requireAdmin = (req, res, next) => {
        if (req.tokenUser && req.tokenUser.role === 'admin') return next();
        return res.status(403).json({ ok: false, error: '需要管理员权限' });
    };

    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, x-account-id, x-admin-token');
        if (req.method === 'OPTIONS') return res.sendStatus(200);
        next();
    });

    const webDist = path.join(__dirname, '../../../web/dist');
    if (!fs.existsSync(webDist)) {
        adminLogger.warn('web build not found', { webDist });
    }

    // 登录：支持用户名+密码（用户表）或仅密码（兼容旧版管理员）
    app.post('/api/login', (req, res) => {
        const { username, password } = req.body || {};
        const name = String(username || '').trim();
        const input = String(password || '');
        let userInfo = null;

        if (name) {
            userInfo = usersModel.validateUser(name, input);
            if (!userInfo) {
                return res.status(401).json({ ok: false, error: '用户名或密码错误' });
            }
        } else {
            const storedHash = store.getAdminPasswordHash ? store.getAdminPasswordHash() : '';
            const ok = storedHash
                ? hashPassword(input) === storedHash
                : input === String(CONFIG.adminPassword || '');
            if (!ok) {
                return res.status(401).json({ ok: false, error: '密码错误' });
            }
            userInfo = { id: 'legacy-admin', username: 'admin', role: usersModel.ROLES.admin };
        }

        const token = issueToken();
        tokenData.set(token, { userId: userInfo.id, username: userInfo.username, role: userInfo.role });
        res.json({ ok: true, data: { token, username: userInfo.username, role: userInfo.role } });
    });

    // 注册：仅可注册普通用户
    app.post('/api/register', (req, res) => {
        try {
            const { username, password } = req.body || {};
            const user = usersModel.createUser(username, password, usersModel.ROLES.user);
            res.status(201).json({ ok: true, data: { id: user.id, username: user.username, role: user.role } });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    app.use('/api', (req, res, next) => {
        if (req.path === '/login' || req.path === '/register' || req.path === '/qr/create' || req.path === '/qr/check') return next();
        return authRequired(req, res, next);
    });

    usersModel.ensureLegacyAdmin(store);

    app.post('/api/admin/change-password', (req, res) => {
        const body = req.body || {};
        const oldPassword = String(body.oldPassword || '');
        const newPassword = String(body.newPassword || '');
        if (newPassword.length < 4) {
            return res.status(400).json({ ok: false, error: '新密码长度至少为 4 位' });
        }
        const user = req.tokenUser;
        if (!user) {
            return res.status(401).json({ ok: false, error: '未登录' });
        }
        if (user.userId === 'legacy-admin') {
            const storedHash = store.getAdminPasswordHash ? store.getAdminPasswordHash() : '';
            const ok = storedHash
                ? hashPassword(oldPassword) === storedHash
                : oldPassword === String(CONFIG.adminPassword || '');
            if (!ok) {
                return res.status(400).json({ ok: false, error: '原密码错误' });
            }
            const nextHash = hashPassword(newPassword);
            if (store.setAdminPasswordHash) {
                store.setAdminPasswordHash(nextHash);
            }
            return res.json({ ok: true });
        }
        try {
            usersModel.changePassword(user.userId, oldPassword, newPassword);
            return res.json({ ok: true });
        } catch (e) {
            return res.status(400).json({ ok: false, error: e.message || '修改失败' });
        }
    });

    app.get('/api/ping', (req, res) => {
        res.json({ ok: true, data: { ok: true, uptime: process.uptime(), version } });
    });

    app.get('/api/auth/validate', (req, res) => {
        const token = req.headers['x-admin-token'];
        const info = token && tokenData.has(token) ? tokenData.get(token) : null;
        if (!info) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }
        res.json({ ok: true, data: { valid: true, username: info.username, role: info.role } });
    });

    // API: 调度任务快照（用于调度收敛排查）
    app.get('/api/scheduler', async (req, res) => {
        try {
            const id = getAccIdOrRespond(req, res);
            if (id === null) return;
            if (provider && typeof provider.getSchedulerStatus === 'function') {
                const data = await provider.getSchedulerStatus(id);
                return res.json({ ok: true, data });
            }
            return res.json({ ok: true, data: { runtime: getSchedulerRegistrySnapshot(), worker: null, workerError: 'DataProvider does not support scheduler status' } });
        } catch (e) {
            return handleApiError(res, e);
        }
    });

    app.post('/api/logout', (req, res) => {
        const token = req.adminToken;
        if (token) {
            tokenData.delete(token);
            if (io) {
                for (const socket of io.sockets.sockets.values()) {
                    if (String(socket.data.adminToken || '') === String(token)) {
                        socket.disconnect(true);
                    }
                }
            }
        }
        res.json({ ok: true });
    });

    const getAccountList = () => {
        try {
            if (provider && typeof provider.getAccounts === 'function') {
                const data = provider.getAccounts();
                if (data && Array.isArray(data.accounts)) return data.accounts;
            }
        } catch {
            // ignore provider failures
        }
        const data = store.getAccounts ? store.getAccounts() : { accounts: [] };
        return Array.isArray(data.accounts) ? data.accounts : [];
    };

    /** 当前登录用户可见的账号列表（按 ownerId 隔离） */
    const getAccountListForUser = (userId) => {
        if (!userId) return [];
        const data = getAccountsByOwner(userId);
        return Array.isArray(data.accounts) ? data.accounts : [];
    };
    getAccountListForUserRef = getAccountListForUser;

    const isSoftRuntimeError = (err) => {
        const msg = String((err && err.message) || '');
        if (msg === '账号未运行' || msg === 'API Timeout') return true;
        if (msg.includes('连接未打开') || msg.includes('请求超时')) return true;
        if (msg.includes('背包') || msg.includes('解析失败') || (msg.startsWith('gamepb.') && msg.includes('错误'))) return true;
        return false;
    };

    function handleApiError(res, err) {
        if (isSoftRuntimeError(err)) {
            return res.json({ ok: false, error: err.message });
        }
        return res.status(500).json({ ok: false, error: err.message });
    }

    const resolveAccId = (rawRef) => {
        const input = normalizeAccountRef(rawRef);
        if (!input) return '';

        if (provider && typeof provider.resolveAccountId === 'function') {
            const resolvedByProvider = normalizeAccountRef(provider.resolveAccountId(input));
            if (resolvedByProvider) return resolvedByProvider;
        }

        const resolved = resolveAccountId(getAccountList(), input);
        return resolved || input;
    };

    // 当前用户是否可操作该账号：管理员可操作任意账号，普通用户仅本人账号
    function canAccessAccount(req, resolvedId) {
        if (!resolvedId) return false;
        const user = req.tokenUser;
        if (!user || !user.userId) return false;
        if (user.role === 'admin') return true;
        const userAccounts = getAccountListForUser(user.userId);
        return userAccounts.some(a => String(a.id) === String(resolvedId) || String(a.uin) === String(resolvedId));
    }

    // Helper to get account ID from header，且仅当该账号属于当前登录用户（或当前用户为管理员）时返回
    function getAccId(req) {
        const rawRef = req.headers['x-account-id'];
        const resolvedId = resolveAccId(rawRef);
        if (!resolvedId) return null;
        return canAccessAccount(req, resolvedId) ? resolvedId : null;
    }

    function getAccIdOrRespond(req, res) {
        const raw = req.headers['x-account-id'];
        if (!raw) {
            res.status(400).json({ ok: false, error: 'Missing x-account-id' });
            return null;
        }
        const id = getAccId(req);
        if (!id) {
            res.status(403).json({ ok: false, error: '无权访问该账号' });
            return null;
        }
        return id;
    }

    // API: 完整状态
    app.get('/api/status', async (req, res) => {
        const id = getAccIdOrRespond(req, res);
        if (id === null) return;
        try {
            const data = provider.getStatus(id);
            if (data && data.status) {
                const { level, exp } = data.status;
                const progress = getLevelExpProgress(level, exp);
                data.levelProgress = progress;
            }
            res.json({ ok: true, data });
        } catch (e) {
            res.json({ ok: false, error: e.message });
        }
    });

    app.post('/api/automation', async (req, res) => {
        const id = getAccIdOrRespond(req, res);
        if (id === null) return;
        try {
            let lastData = null;
            for (const [k, v] of Object.entries(req.body)) {
                lastData = await provider.setAutomation(id, k, v);
            }
            res.json({ ok: true, data: lastData || {} });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 农田详情
    app.get('/api/lands', async (req, res) => {
        const id = getAccIdOrRespond(req, res);
        if (id === null) return;
        try {
            const data = await provider.getLands(id);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 好友列表（支持分页，避免好友过多时单次响应过大导致超时与卡顿）
    app.get('/api/friends', async (req, res) => {
        const id = getAccIdOrRespond(req, res);
        if (id === null) return;
        try {
            const page = req.query.page != null ? parseInt(req.query.page, 10) : undefined;
            const pageSize = req.query.pageSize != null ? parseInt(req.query.pageSize, 10) : undefined;
            const data = await provider.getFriends(id, page, pageSize);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 好友农田详情
    app.get('/api/friend/:gid/lands', async (req, res) => {
        const id = getAccIdOrRespond(req, res);
        if (id === null) return;
        try {
            const data = await provider.getFriendLands(id, req.params.gid);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 对指定好友执行单次操作（偷菜/浇水/除草/捣乱）
    app.post('/api/friend/:gid/op', async (req, res) => {
        const id = getAccIdOrRespond(req, res);
        if (id === null) return;
        try {
            const opType = String((req.body || {}).opType || '');
            const data = await provider.doFriendOp(id, req.params.gid, opType);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 好友黑名单
    app.get('/api/friend-blacklist', (req, res) => {
        const id = getAccIdOrRespond(req, res);
        if (id === null) return;
        const list = store.getFriendBlacklist ? store.getFriendBlacklist(id) : [];
        res.json({ ok: true, data: list });
    });

    app.post('/api/friend-blacklist/toggle', (req, res) => {
        const id = getAccIdOrRespond(req, res);
        if (id === null) return;
        const gid = Number((req.body || {}).gid);
        if (!gid) return res.status(400).json({ ok: false, error: 'Missing gid' });
        const current = store.getFriendBlacklist ? store.getFriendBlacklist(id) : [];
        let next;
        if (current.includes(gid)) {
            next = current.filter(g => g !== gid);
        } else {
            next = [...current, gid];
        }
        const saved = store.setFriendBlacklist ? store.setFriendBlacklist(id, next) : next;
        // 同步配置到 worker 进程
        if (provider && typeof provider.broadcastConfig === 'function') {
            provider.broadcastConfig(id);
        }
        res.json({ ok: true, data: saved });
    });

    // API: 农场已封禁名单（访问/操作好友时提示封禁则自动加入，脚本不再巡田）
    app.get('/api/friends/farm-banned', (req, res) => {
        const id = getAccIdOrRespond(req, res);
        if (id === null) return;
        const list = store.getFarmBannedList ? store.getFarmBannedList(id) : [];
        res.json({ ok: true, data: list });
    });

    app.post('/api/friends/farm-banned/remove', (req, res) => {
        const id = getAccIdOrRespond(req, res);
        if (id === null) return;
        const gid = Number((req.body || {}).gid);
        if (!gid) return res.status(400).json({ ok: false, error: 'Missing gid' });
        const saved = store.removeFromFarmBanned ? store.removeFromFarmBanned(id, gid) : [];
        if (provider && typeof provider.broadcastConfig === 'function') {
            provider.broadcastConfig(id);
        }
        res.json({ ok: true, data: saved });
    });

    // API: 偷取黑名单（不偷取的作物 seedId 列表）
    app.get('/api/steal-blacklist', (req, res) => {
        const id = getAccIdOrRespond(req, res);
        if (id === null) return;
        const list = store.getStealBlacklist ? store.getStealBlacklist(id) : [];
        res.json({ ok: true, data: list });
    });

    app.post('/api/steal-blacklist', (req, res) => {
        const id = getAccIdOrRespond(req, res);
        if (id === null) return;
        const body = req.body || {};
        const list = Array.isArray(body.seedIds) ? body.seedIds.map(Number).filter(n => Number.isFinite(n) && n >= 0) : [];
        const saved = store.setStealBlacklist ? store.setStealBlacklist(id, list) : list;
        if (provider && typeof provider.broadcastConfig === 'function') {
            provider.broadcastConfig(id);
        }
        res.json({ ok: true, data: saved });
    });

    // API: 种子列表
    app.get('/api/seeds', async (req, res) => {
        const id = getAccIdOrRespond(req, res);
        if (id === null) return;
        try {
            const data = await provider.getSeeds(id);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 背包物品
    app.get('/api/bag', async (req, res) => {
        const id = getAccIdOrRespond(req, res);
        if (id === null) return;
        try {
            const data = await provider.getBag(id);
            if (data && data._error) {
                return res.json({ ok: false, error: data._error });
            }
            res.json({ ok: true, data: { totalKinds: data.totalKinds, items: data.items || [] } });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    app.post('/api/bag/use', async (req, res) => {
        const id = getAccIdOrRespond(req, res);
        if (id === null) return;
        try {
            const { itemId, count } = req.body;
            if (!itemId) return res.status(400).json({ ok: false, error: '缺少 itemId' });
            const data = await provider.useItem(id, Number(itemId), Math.max(1, Number(count) || 1));
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    app.post('/api/bag/sell', async (req, res) => {
        const id = getAccIdOrRespond(req, res);
        if (id === null) return;
        try {
            const { items } = req.body;
            if (!Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ ok: false, error: '缺少出售物品列表' });
            }
            const data = await provider.sellItems(id, items);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 每日礼包状态总览
    app.get('/api/daily-gifts', async (req, res) => {
        const id = getAccIdOrRespond(req, res);
        if (id === null) return;
        try {
            const data = await provider.getDailyGifts(id);
            res.json({ ok: true, data });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 启动账号（管理员可操作任意账号，普通用户仅本人账号）
    app.post('/api/accounts/:id/start', (req, res) => {
        try {
            const resolvedId = resolveAccId(req.params.id);
            if (!canAccessAccount(req, resolvedId)) {
                return res.status(403).json({ ok: false, error: '无权操作该账号' });
            }
            const isAdmin = req.tokenUser && req.tokenUser.role === 'admin';
            const accountList = isAdmin ? (store.getAccounts ? store.getAccounts() : { accounts: [] }).accounts || [] : getAccountListForUser(req.tokenUser && req.tokenUser.userId);
            const acc = (accountList || []).find(a => String(a.id) === String(resolvedId) || String(a.uin) === String(resolvedId));
            if (acc && acc.loginDisabled) {
                return res.status(403).json({ ok: false, error: '该账号已被封禁，无法启动' });
            }
            const boundCards = cardsModel.getCardsByBoundAccountId(resolvedId);
            if (!boundCards || boundCards.length === 0) {
                return res.status(403).json({ ok: false, error: '请先绑定卡密后再启动' });
            }
            const ok = provider.startAccount(resolvedId);
            if (!ok) {
                return res.status(404).json({ ok: false, error: 'Account not found' });
            }
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 停止账号（管理员可操作任意账号，普通用户仅本人账号）
    app.post('/api/accounts/:id/stop', (req, res) => {
        try {
            const resolvedId = resolveAccId(req.params.id);
            if (!canAccessAccount(req, resolvedId)) {
                return res.status(403).json({ ok: false, error: '无权操作该账号' });
            }
            const ok = provider.stopAccount(resolvedId);
            if (!ok) {
                return res.status(404).json({ ok: false, error: 'Account not found' });
            }
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 卡密续费（为新卡密绑定到当前账号，时长叠加；永久不降级）
    app.post('/api/accounts/:id/renew-card', (req, res) => {
        try {
            const resolvedId = resolveAccId(req.params.id);
            if (!canAccessAccount(req, resolvedId)) {
                return res.status(403).json({ ok: false, error: '无权操作该账号' });
            }
            const body = req.body && typeof req.body === 'object' ? req.body : {};
            const code = (body.code || '').toString().trim();
            if (!code) {
                return res.status(400).json({ ok: false, error: '请填写新卡密' });
            }
            const verifyResult = cardsModel.verifyCard(code);
            if (!verifyResult.valid) {
                return res.status(400).json({ ok: false, error: verifyResult.message || '卡密无效' });
            }
            const newCardMeta = verifyResult.card;
            const typeInfo = cardsModel.CARD_TYPES && cardsModel.CARD_TYPES[newCardMeta.type];
            const newCardDays = typeInfo && typeInfo.days != null ? typeInfo.days : 30;
            const now = Date.now();
            const boundCards = cardsModel.getCardsByBoundAccountId(resolvedId);
            // 叠加基准：取当前账号已绑定卡密中的最大未过期到期时间，支持一账号多卡
            let baseTime = now;
            const hasPermanent = boundCards.some(c => c.expiresAt == null);
            if (!hasPermanent && boundCards.length > 0) {
                const maxExpiry = Math.max(...boundCards.map(c => c.expiresAt).filter(t => t != null && t > now));
                if (Number.isFinite(maxExpiry)) baseTime = maxExpiry;
            }
            const accountIsPermanent = hasPermanent;
            const newCardIsPermanent = newCardMeta.type === 'permanent' || (typeInfo && typeInfo.days == null);
            let overrideExpiresAt = null;
            if (accountIsPermanent || newCardIsPermanent) {
                overrideExpiresAt = null;
            } else {
                overrideExpiresAt = baseTime + newCardDays * 24 * 60 * 60 * 1000;
            }
            const { accounts } = store.getAccounts ? store.getAccounts() : { accounts: [] };
            const acc = (accounts || []).find(a => String(a.id) === String(resolvedId));
            const displayName = acc ? ((acc.name && String(acc.name).trim()) || (acc.nick && String(acc.nick).trim()) || (acc.uin && String(acc.uin)) || resolvedId) : resolvedId;
            const displayUin = acc && acc.uin != null ? String(acc.uin).trim() : null;
            // 仅激活新卡并绑定到该账号，不解绑已有卡密（同一 QQ 可绑定多张卡，到期时间叠加）
            const card = cardsModel.activateCard(code, resolvedId, {
                overrideExpiresAt,
                lastBoundAccountName: displayName,
                lastBoundAccountUin: displayUin,
            });
            res.json({ ok: true, data: card });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    // API: 农场一键操作
    app.post('/api/farm/operate', async (req, res) => {
        const id = getAccIdOrRespond(req, res);
        if (id === null) return;
        try {
            const { opType } = req.body; // 'harvest', 'clear', 'plant', 'all'
            await provider.doFarmOp(id, opType);
            res.json({ ok: true });
        } catch (e) {
            handleApiError(res, e);
        }
    });

    // API: 数据分析
    app.get('/api/analytics', async (req, res) => {
        try {
            const sortBy = req.query.sort || 'exp';
            const { getPlantRankings } = require('../services/analytics');
            const data = getPlantRankings(sortBy);
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 设置页统一保存（单次写入+单次广播）
    app.post('/api/settings/save', async (req, res) => {
        const id = getAccIdOrRespond(req, res);
        if (id === null) return;
        try {
            const data = await provider.saveSettings(id, req.body || {});
            res.json({ ok: true, data: data || {} });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 设置面板主题
    app.post('/api/settings/theme', async (req, res) => {
        try {
            const theme = String((req.body || {}).theme || '');
            const data = await provider.setUITheme(theme);
            res.json({ ok: true, data: data || {} });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 设置颜色主题（按账号独立，跨设备同步）
    app.post('/api/settings/color-theme', async (req, res) => {
        try {
            const accountId = (req.headers['x-account-id'] || '').trim();
            const colorTheme = String((req.body || {}).colorTheme || 'default').trim() || 'default';
            const ui = accountId ? store.setAccountUI(accountId, { colorTheme }) : store.setUIColorTheme(colorTheme);
            res.json({ ok: true, data: { ui } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 设置自定义背景图（按账号独立，跨设备同步）
    app.post('/api/settings/custom-background', async (req, res) => {
        try {
            const accountId = (req.headers['x-account-id'] || '').trim();
            if (!accountId) return res.status(400).json({ ok: false, error: 'Missing x-account-id' });
            const customBackgroundUrl = typeof (req.body || {}).customBackgroundUrl === 'string' ? String(req.body.customBackgroundUrl).trim() : '';
            const ui = store.setAccountUI(accountId, { customBackgroundUrl });
            res.json({ ok: true, data: { ui } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 获取UI配置（主题+自定义背景；可选 x-account-id 按账号返回）
    app.get('/api/settings/ui', (req, res) => {
        try {
            const accountId = (req.headers['x-account-id'] || '').trim();
            const ui = store.getUI(accountId);
            res.json({ ok: true, data: { ui } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 保存下线提醒配置
    app.post('/api/settings/offline-reminder', async (req, res) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const data = store.setOfflineReminder ? store.setOfflineReminder(body) : {};
            res.json({ ok: true, data: data || {} });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 获取配置
    app.get('/api/settings', async (req, res) => {
        try {
            const id = getAccIdOrRespond(req, res);
            if (id === null) return;
            // 直接从主进程的 store 读取，确保即使账号未运行也能获取配置
            const intervals = store.getIntervals(id);
            const strategy = store.getPlantingStrategy(id);
            const preferredSeed = store.getPreferredSeed(id);
            const friendQuietHours = store.getFriendQuietHours(id);
            const automation = store.getAutomation(id);
            const stealDelaySeconds = (typeof store.getStealDelaySeconds === 'function') ? store.getStealDelaySeconds(id) : 0;
            const friendOpOrder = (typeof store.getFriendOpOrder === 'function') ? store.getFriendOpOrder(id) : ['help', 'steal', 'bad'];
            const plantOrderRandom = (typeof store.getPlantOrderRandom === 'function') ? store.getPlantOrderRandom(id) : false;
            const fertilizerOrderRandom = (typeof store.getFertilizerOrderRandom === 'function') ? store.getFertilizerOrderRandom(id) : false;
            const plantDelaySeconds = (typeof store.getPlantDelaySeconds === 'function') ? store.getPlantDelaySeconds(id) : 0;
            const ui = store.getUI(id);
            const offlineReminder = store.getOfflineReminder
                ? store.getOfflineReminder()
                : { channel: 'webhook', reloginUrlMode: 'none', endpoint: '', token: '', title: '账号下线提醒', msg: '账号下线', offlineDeleteSec: 120 };
            res.json({ ok: true, data: { intervals, strategy, preferredSeed, friendQuietHours, automation, stealDelaySeconds, friendOpOrder, plantOrderRandom, fertilizerOrderRandom, plantDelaySeconds, ui, offlineReminder } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 校验 QQ 是否可跳过卡密：当前账号列表中该 QQ 已绑定有效卡，或该 QQ 曾激活过且卡密未到期（含账号已移除的情况）。
    // 卡密解除绑定后，该 QQ 的 lastBound/activatedAt 已清空，此处会返回未激活/未绑定有效卡密，需输入卡密才能扫码。
    app.get('/api/accounts/check-uin', (req, res) => {
        try {
            const uin = (req.query.uin || req.query.qq || '').toString().trim();
            if (!uin) {
                return res.json({ ok: true, data: { canSkipCard: false, message: '请输入QQ号' } });
            }
            const { accounts } = store.getAccounts ? store.getAccounts() : { accounts: [] };
            const acc = (accounts || []).find(
                (a) => String(a.uin || '').trim() === uin || String(a.qq || '').trim() === uin
            );
            if (acc && acc.id) {
                const cardInfo = cardsModel.getAccountEffectiveCardInfo(acc.id);
                if (cardInfo) {
                    const now = Date.now();
                    if (cardInfo.expiresAt == null || cardInfo.expiresAt >= now) {
                        return res.json({
                            ok: true,
                            data: {
                                canSkipCard: true,
                                message: '该QQ已激活且未过期，可直接扫码添加',
                                accountId: acc.id,
                            },
                        });
                    }
                }
            }
            const cardByLastUin = typeof cardsModel.findValidCardByLastBoundUin === 'function'
                ? cardsModel.findValidCardByLastBoundUin(uin)
                : null;
            if (cardByLastUin) {
                return res.json({
                    ok: true,
                    data: {
                        canSkipCard: true,
                        message: '该QQ曾激活且卡密未到期，可直接扫码添加（将自动绑定原卡密）',
                        accountId: null,
                    },
                });
            }
            if (acc && acc.id) {
                const cardInfo = cardsModel.getAccountEffectiveCardInfo(acc.id);
                if (!cardInfo) {
                    return res.json({ ok: true, data: { canSkipCard: false, message: '该QQ未绑定有效卡密' } });
                }
                return res.json({ ok: true, data: { canSkipCard: false, message: '该QQ卡密已过期' } });
            }
            return res.json({ ok: true, data: { canSkipCard: false, message: '该QQ尚未在本系统激活' } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 账号管理（管理员返回全部账号并按 owner 附带 ownerUsername；普通用户仅返回本人账号）
    app.get('/api/accounts', (req, res) => {
        try {
            const userId = req.tokenUser && req.tokenUser.userId;
            const isAdmin = req.tokenUser && req.tokenUser.role === 'admin';
            const data = isAdmin
                ? (store.getAccounts ? store.getAccounts() : { accounts: [], nextId: 1 })
                : getAccountsByOwner(userId);
            let accounts = Array.isArray(data.accounts) ? data.accounts : [];
            // 按 id 去重，避免多端或历史数据导致同账号出现多条
            const seenIds = new Set();
            accounts = accounts.filter((a) => {
                const id = a && String(a.id || '');
                if (!id || seenIds.has(id)) return false;
                seenIds.add(id);
                return true;
            });
            let fullWithRunning = { accounts: [] };
            try {
                fullWithRunning = provider.getAccounts ? provider.getAccounts() : { accounts: [] };
            } catch {
                // ignore
            }
            const runningMap = new Map(
                (fullWithRunning.accounts || []).map(a => [String(a.id), !!a.running])
            );
            const connectedMap = new Map(
                (fullWithRunning.accounts || []).map(a => [String(a.id), !!a.connected])
            );
            const ownerNameMap = new Map();
            if (isAdmin && accounts.length > 0) {
                for (const acc of accounts) {
                    const oid = acc.ownerId != null ? String(acc.ownerId) : '';
                    if (oid && !ownerNameMap.has(oid)) {
                        if (oid === 'legacy-admin') {
                            ownerNameMap.set(oid, '管理员');
                        } else {
                            const u = usersModel.findUserById(oid);
                            ownerNameMap.set(oid, (u && u.username) ? u.username : oid || '未知');
                        }
                    }
                    if (!oid) ownerNameMap.set('', '历史账号');
                }
            }
            for (const acc of accounts) {
                acc.running = runningMap.get(String(acc.id)) != null ? runningMap.get(String(acc.id)) : false;
                acc.connected = connectedMap.get(String(acc.id)) != null ? connectedMap.get(String(acc.id)) : false;
                const cardInfo = cardsModel.getAccountEffectiveCardInfo(acc.id);
                acc.cardInfo = cardInfo
                    ? { code: cardInfo.code, type: cardInfo.type, expiresAt: cardInfo.expiresAt, cardCount: cardInfo.cardCount }
                    : null;
                if (isAdmin) {
                    const oid = acc.ownerId != null ? String(acc.ownerId) : '';
                    acc.ownerUsername = ownerNameMap.get(oid) || (oid === 'legacy-admin' ? '管理员' : oid || '历史账号');
                }
            }
            const full = store.getAccounts ? store.getAccounts() : { nextId: 1 };
            res.json({ ok: true, data: { accounts, nextId: full.nextId || 1 } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 更新账号备注（兼容旧接口，仅允许修改本人账号）
    app.post('/api/account/remark', (req, res) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const rawRef = body.id || body.accountId || body.uin || req.headers['x-account-id'];
            const resolvedId = resolveAccId(rawRef);
            if (!resolvedId || !canAccessAccount(req, resolvedId)) {
                return res.status(403).json({ ok: false, error: '无权操作该账号' });
            }
            const isAdmin = req.tokenUser && req.tokenUser.role === 'admin';
            const accountList = isAdmin ? (store.getAccounts ? store.getAccounts() : { accounts: [] }).accounts || [] : getAccountListForUser(req.tokenUser && req.tokenUser.userId);
            const target = findAccountByRef(accountList, rawRef);
            if (!target || !target.id) {
                return res.status(404).json({ ok: false, error: 'Account not found' });
            }

            const remark = String(body.remark !== undefined ? body.remark : body.name || '').trim();
            if (!remark) {
                return res.status(400).json({ ok: false, error: 'Missing remark' });
            }

            const accountId = String(target.id);
            const data = addOrUpdateAccount({ id: accountId, name: remark });
            if (provider && typeof provider.setRuntimeAccountName === 'function') {
                provider.setRuntimeAccountName(accountId, remark);
            }
            if (provider && provider.addAccountLog) {
                provider.addAccountLog('update', `更新账号备注: ${remark}`, accountId, remark);
            }
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/accounts', (req, res) => {
        try {
            const userId = req.tokenUser && req.tokenUser.userId;
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const isUpdate = !!body.id;
            const resolvedUpdateId = isUpdate ? resolveAccId(body.id) : '';
            const payload = isUpdate ? { ...body, id: resolvedUpdateId || String(body.id) } : body;
            if (isUpdate) {
                if (!canAccessAccount(req, resolvedUpdateId)) {
                    return res.status(403).json({ ok: false, error: '无权操作该账号' });
                }
            } else {
                payload.ownerId = userId;
            }
            let wasRunning = false;
            if (isUpdate && provider.isAccountRunning) {
                wasRunning = provider.isAccountRunning(payload.id);
            }

            const data = addOrUpdateAccount(payload);
            const finalAccount = isUpdate
                ? (data.accounts || []).find((a) => String(a.id) === String(payload.id))
                : (data.accounts || [])[data.accounts && data.accounts.length > 0 ? data.accounts.length - 1 : -1];
            if (finalAccount && finalAccount.id && typeof cardsModel.findValidCardByLastBoundUin === 'function' && typeof cardsModel.rebindCardToAccount === 'function') {
                const uinStr = String(finalAccount.uin || finalAccount.qq || '').trim();
                if (uinStr) {
                    const orphanCard = cardsModel.findValidCardByLastBoundUin(uinStr);
                    if (orphanCard) {
                        cardsModel.rebindCardToAccount(orphanCard.id, finalAccount.id, {
                            accountName: finalAccount.name || finalAccount.nick || finalAccount.id,
                            accountUin: uinStr,
                        });
                    }
                }
            }
            if (provider.addAccountLog) {
                const accountId = isUpdate ? String(payload.id) : String((data.accounts[data.accounts.length - 1] || {}).id || '');
                const accountName = payload.name || '';
                provider.addAccountLog(
                    isUpdate ? 'update' : 'add',
                    isUpdate ? `更新账号: ${accountName || accountId}` : `添加账号: ${accountName || accountId}`,
                    accountId,
                    accountName
                );
            }
            // 如果是新增，自动启动
            if (!isUpdate) {
                const newAcc = data.accounts[data.accounts.length - 1];
                if (newAcc) provider.startAccount(newAcc.id);
            } else if (wasRunning) {
                // 如果是更新，且之前在运行，则重启
                provider.restartAccount(payload.id);
            }
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.delete('/api/accounts/:id', (req, res) => {
        try {
            const resolvedId = resolveAccId(req.params.id) || String(req.params.id || '');
            if (!canAccessAccount(req, resolvedId)) {
                return res.status(403).json({ ok: false, error: '无权操作该账号' });
            }
            const isAdmin = req.tokenUser && req.tokenUser.role === 'admin';
            const accountList = isAdmin ? (store.getAccounts ? store.getAccounts() : { accounts: [] }).accounts || [] : getAccountListForUser(req.tokenUser && req.tokenUser.userId);
            const target = findAccountByRef(accountList, req.params.id);
            if (!target) {
                return res.status(404).json({ ok: false, error: 'Account not found' });
            }
            provider.stopAccount(resolvedId);
            const data = deleteAccount(resolvedId);
            if (provider.addAccountLog) {
                provider.addAccountLog('delete', `删除账号: ${(target && target.name) || req.params.id}`, resolvedId, target ? target.name : '');
            }
            if (provider.purgeLogsForAccount) {
                provider.purgeLogsForAccount(resolvedId);
            }
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // API: 账号日志（仅返回当前用户账号的操作日志）
    app.get('/api/account-logs', (req, res) => {
        try {
            const limit = Number.parseInt(req.query.limit) || 100;
            const raw = provider.getAccountLogs ? provider.getAccountLogs(limit * 2) : [];
            const userAccountIds = new Set(getAccountListForUser(req.tokenUser && req.tokenUser.userId).map(a => String(a.id)));
            const list = (Array.isArray(raw) ? raw : []).filter(entry => userAccountIds.has(String(entry.accountId || ''))).slice(0, limit);
            res.json(list);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ============ 用户管理（仅管理员） ============
    app.get('/api/admin/users', requireAdmin, (req, res) => {
        try {
            const list = usersModel.listAllUsers();
            res.json({ ok: true, data: list });
        } catch (e) {
            return handleApiError(res, e);
        }
    });

    app.get('/api/admin/users/:id/cards', requireAdmin, (req, res) => {
        try {
            const userId = String(req.params.id || '').trim();
            const { accounts } = getAccountsByOwner(userId);
            const accountIds = new Set((accounts || []).map(a => String(a.id)));
            const allCards = cardsModel.getCards({});
            const cards = (Array.isArray(allCards) ? allCards : []).filter(c =>
                (c.boundAccountId && accountIds.has(String(c.boundAccountId)))
                || (c.lastBoundAccountId && accountIds.has(String(c.lastBoundAccountId))),
            );
            const CARD_TYPES = cardsModel.CARD_TYPES || {};
            const list = cards.map(c => ({
                id: c.id,
                code: c.code,
                type: c.type,
                typeLabel: (CARD_TYPES[c.type] && CARD_TYPES[c.type].label) || c.type,
                used: c.boundAccountId != null && c.activatedAt != null,
                boundAccountId: c.boundAccountId,
                lastBoundAccountId: c.lastBoundAccountId,
                activatedAt: c.activatedAt,
                expiresAt: c.expiresAt,
                status: c.status,
            }));
            res.json({ ok: true, data: list });
        } catch (e) {
            return handleApiError(res, e);
        }
    });

    app.post('/api/admin/users/:id/password', requireAdmin, (req, res) => {
        try {
            const userId = req.params.id;
            const newPassword = String((req.body && req.body.newPassword) || '').trim();
            if (newPassword.length < 4) return res.status(400).json({ ok: false, error: '新密码至少 4 位' });
            usersModel.adminSetPassword(userId, newPassword);
            res.json({ ok: true });
        } catch (e) {
            return res.status(400).json({ ok: false, error: e.message || '修改失败' });
        }
    });

    app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
        try {
            const userId = req.params.id;
            if (req.tokenUser && String(req.tokenUser.userId) === String(userId)) {
                return res.status(400).json({ ok: false, error: '不能删除当前登录账号' });
            }
            usersModel.deleteUser(userId);
            res.json({ ok: true });
        } catch (e) {
            return res.status(400).json({ ok: false, error: e.message || '删除失败' });
        }
    });

    app.post('/api/admin/users/:id/ban', requireAdmin, (req, res) => {
        try {
            const userId = req.params.id;
            if (req.tokenUser && String(req.tokenUser.userId) === String(userId)) {
                return res.status(400).json({ ok: false, error: '不能封禁当前登录账号' });
            }
            usersModel.setUserBanned(userId, true);
            res.json({ ok: true });
        } catch (e) {
            return res.status(400).json({ ok: false, error: e.message || '封禁失败' });
        }
    });

    app.post('/api/admin/users/:id/unban', requireAdmin, (req, res) => {
        try {
            const userId = req.params.id;
            usersModel.setUserBanned(userId, false);
            res.json({ ok: true });
        } catch (e) {
            return res.status(400).json({ ok: false, error: e.message || '解封失败' });
        }
    });

    // ============ 卡密管理（仅管理员） ============
    // 统计：总会话数(总卡密数)、当前在线人数(Socket 连接数)、总卡密激活数
    app.get('/api/cards/stats', requireAdmin, (req, res) => {
        try {
            const cardStats = cardsModel.getStats();
            const onlineCount = io && io.sockets ? io.sockets.sockets.size : 0;
            res.json({
                ok: true,
                data: {
                    totalCards: cardStats.total,
                    activatedCards: cardStats.activated,
                    onlineCount,
                    active: cardStats.active,
                    banned: cardStats.banned,
                    expired: cardStats.expired,
                },
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.get('/api/cards', requireAdmin, (req, res) => {
        try {
            const status = (req.query.status || '').toString().trim() || undefined;
            const type = (req.query.type || '').toString().trim() || undefined;
            const search = (req.query.search || '').toString().trim() || undefined;
            const { accounts } = store.getAccounts ? store.getAccounts() : { accounts: [] };
            const accountNameMap = new Map();
            const accountUinMap = new Map();
            const accountIdToOwnerUsername = new Map();
            for (const a of (accounts || [])) {
                const id = String(a.id || '');
                const displayName = (a.name && String(a.name).trim()) || (a.nick && String(a.nick).trim()) || (a.uin && String(a.uin)) || id;
                accountNameMap.set(id, displayName);
                if (a.uin != null && String(a.uin).trim()) accountUinMap.set(id, String(a.uin).trim());
                const oid = a.ownerId != null ? String(a.ownerId) : '';
                const u = oid ? usersModel.findUserById(oid) : null;
                const ownerUsername = oid === 'legacy-admin' ? '管理员' : (oid ? (u && u.username ? u.username : oid) : '历史账号');
                accountIdToOwnerUsername.set(id, ownerUsername || '未知');
            }
            let list = cardsModel.getCards({ status, type });
            if (search) {
                const q = search.toLowerCase();
                const match = (c) => {
                    const boundId = c.boundAccountId ? String(c.boundAccountId) : null;
                    const displayId = boundId || (c.lastBoundAccountId ? String(c.lastBoundAccountId) : null);
                    const boundName = boundId ? (accountNameMap.get(boundId) || boundId) : (c.lastBoundAccountName || (displayId ? (accountNameMap.get(displayId) || displayId) : ''));
                    const boundUin = boundId ? (accountUinMap.get(boundId) || '') : (c.lastBoundAccountUin != null ? c.lastBoundAccountUin : (displayId ? accountUinMap.get(displayId) : ''));
                    const ownerUsername = displayId ? (accountIdToOwnerUsername.get(displayId) || '') : '';
                    const claimedBy = c.claimedByUsername ? String(c.claimedByUsername).toLowerCase() : '';
                    return (c.code && c.code.toLowerCase().includes(q))
                        || (c.remark && c.remark.toLowerCase().includes(q))
                        || (c.boundAccountId && c.boundAccountId.toLowerCase().includes(q))
                        || (c.lastBoundAccountId && c.lastBoundAccountId.toLowerCase().includes(q))
                        || (boundName && String(boundName).toLowerCase().includes(q))
                        || (boundUin && String(boundUin).toLowerCase().includes(q))
                        || (ownerUsername && String(ownerUsername).toLowerCase().includes(q))
                        || (claimedBy && claimedBy.includes(q));
                };
                list = list.filter(match);
            }
            const enriched = list.map((c) => {
                const boundId = c.boundAccountId ? String(c.boundAccountId) : null;
                const displayId = boundId || (c.lastBoundAccountId ? String(c.lastBoundAccountId) : null);
                const nameFromMap = accountNameMap.get(boundId);
                const boundAccountName = boundId
                    ? (nameFromMap != null ? nameFromMap : c.lastBoundAccountName || boundId)
                    : (c.lastBoundAccountName || (displayId ? (accountNameMap.get(displayId) || displayId) : null));
                const uinFromMap = accountUinMap.get(boundId);
                const boundAccountUin = boundId
                    ? (uinFromMap != null ? uinFromMap : (c.lastBoundAccountUin != null ? c.lastBoundAccountUin : null))
                    : (c.lastBoundAccountUin != null ? c.lastBoundAccountUin : (displayId ? accountUinMap.get(displayId) : null));
                return { ...c, boundAccountName, boundAccountUin };
            });
            res.json({ ok: true, data: enriched });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 当前登录用户的卡密：已用（绑定到其 QQ 账号的）+ 未用（领取的免费永久卡未绑定），区分 used: true/false
    app.get('/api/cards/my-used', (req, res) => {
        try {
            const userId = req.tokenUser && req.tokenUser.userId;
            if (!userId) return res.status(401).json({ ok: false, error: '未登录' });
            const userAccounts = getAccountListForUser(userId);
            const userAccountIds = new Set((userAccounts || []).map(a => String(a.id)));
            const allCards = cardsModel.getCards({});
            const CARD_TYPES = cardsModel.CARD_TYPES || {};
            const usedCards = (Array.isArray(allCards) ? allCards : []).filter(c => {
                const bound = c.boundAccountId && userAccountIds.has(String(c.boundAccountId));
                const everBound = c.lastBoundAccountId && userAccountIds.has(String(c.lastBoundAccountId));
                return bound || everBound;
            });
            // 领取但未使用的卡密：当前用户领取且未绑定
            const unusedClaimed = (Array.isArray(allCards) ? allCards : []).filter(c =>
                String(c.claimedByUserId || '').trim() === String(userId).trim() && !(c.boundAccountId && String(c.boundAccountId).trim()));
            const { accounts } = store.getAccounts ? store.getAccounts() : { accounts: [] };
            const accountNameMap = new Map();
            const accountUinMap = new Map();
            for (const a of (accounts || [])) {
                const id = String(a.id || '');
                const displayName = (a.name && String(a.name).trim()) || (a.nick && String(a.nick).trim()) || (a.uin && String(a.uin)) || id;
                accountNameMap.set(id, displayName);
                if (a.uin != null && String(a.uin).trim()) accountUinMap.set(id, String(a.uin).trim());
            }
            const usedList = usedCards.map((c) => {
                const boundId = c.boundAccountId ? String(c.boundAccountId) : null;
                const displayId = boundId || (c.lastBoundAccountId ? String(c.lastBoundAccountId) : null);
                const nameFromMap = accountNameMap.get(boundId);
                const boundAccountName = boundId
                    ? (nameFromMap != null ? nameFromMap : c.lastBoundAccountName || boundId)
                    : (c.lastBoundAccountName || (displayId ? (accountNameMap.get(displayId) || displayId) : null));
                const uinFromMap = accountUinMap.get(boundId);
                const boundAccountUin = boundId
                    ? (uinFromMap != null ? uinFromMap : (c.lastBoundAccountUin != null ? c.lastBoundAccountUin : null))
                    : (c.lastBoundAccountUin != null ? c.lastBoundAccountUin : (displayId ? accountUinMap.get(displayId) : null));
                const typeLabel = (CARD_TYPES[c.type] && CARD_TYPES[c.type].label) ? CARD_TYPES[c.type].label : (c.type || '');
                return {
                    code: c.code,
                    type: c.type,
                    typeLabel,
                    used: true,
                    boundAccountId: boundId,
                    boundAccountName,
                    boundAccountUin,
                    usedAt: c.activatedAt != null ? c.activatedAt : null,
                    claimedByUsername: c.claimedByUsername || null,
                };
            });
            const unusedList = unusedClaimed.map((c) => {
                const typeLabel = (CARD_TYPES[c.type] && CARD_TYPES[c.type].label) ? CARD_TYPES[c.type].label : (c.type || '');
                return {
                    code: c.code,
                    type: c.type,
                    typeLabel,
                    used: false,
                    boundAccountId: null,
                    boundAccountName: null,
                    boundAccountUin: null,
                    usedAt: null,
                    claimedByUsername: c.claimedByUsername || null,
                };
            });
            const list = usedList.concat(unusedList);
            res.json({ ok: true, data: list });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 查询当前登录用户免费永久卡剩余领取次数（与网站注册账号关联，非 QQ 账号）
    app.get('/api/cards/free-claim-quota', (req, res) => {
        try {
            const userId = req.tokenUser && req.tokenUser.userId;
            if (!userId) return res.status(401).json({ ok: false, error: '未登录' });
            const count = cardsModel.getFreeClaimCount(userId);
            res.json({ ok: true, data: { limit: 3, remainingClaims: Math.max(0, 3 - count) } });
        } catch (e) {
            res.json({ ok: true, data: { limit: 3, remainingClaims: 0 } });
        }
    });

    // 领取免费永久卡（每网站用户限领 3 次；与网站登录账号关联；卡密未绑定 QQ，领取人信息用于卡密列表展示）
    app.post('/api/cards/claim-free', (req, res) => {
        try {
            const userId = req.tokenUser && req.tokenUser.userId;
            const username = (req.tokenUser && req.tokenUser.username) ? String(req.tokenUser.username).trim() : '';
            if (!userId) return res.status(401).json({ ok: false, error: '未登录' });
            const card = cardsModel.claimFreePermanentCard(userId, username);
            const remaining = Math.max(0, 3 - cardsModel.getFreeClaimCount(userId));
            res.json({ ok: true, data: { card, remainingClaims: remaining } });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message || '领取失败' });
        }
    });

    // 验证卡密（有效性与时效性），用于添加账号前校验。必须在 /api/cards/:id 之前注册，否则 verify 会被 :id 匹配成 id="verify"
    app.get('/api/cards/verify', (req, res) => {
        try {
            const code = (req.query.code || '').toString().trim();
            const result = cardsModel.verifyCard(code);
            res.json({ ok: true, data: result });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 单条卡密（需在 /api/cards/stats、/api/cards、/api/cards/my-used、/api/cards/verify 之后注册，避免 :id 抢匹配）
    app.get('/api/cards/:id', requireAdmin, (req, res) => {
        try {
            const id = (req.params.id || '').toString().trim();
            const card = cardsModel.getCardById(id);
            if (!card) return res.status(404).json({ ok: false, error: '卡密不存在' });
            const { accounts } = store.getAccounts ? store.getAccounts() : { accounts: [] };
            const accountNameMap = new Map();
            const accountUinMap = new Map();
            for (const a of (accounts || [])) {
                const accId = String(a.id || '');
                const displayName = (a.name && String(a.name).trim()) || (a.nick && String(a.nick).trim()) || (a.uin && String(a.uin)) || accId;
                accountNameMap.set(accId, displayName);
                if (a.uin != null && String(a.uin).trim()) accountUinMap.set(accId, String(a.uin).trim());
            }
            const boundId = card.boundAccountId ? String(card.boundAccountId) : null;
            const displayId = boundId || (card.lastBoundAccountId ? String(card.lastBoundAccountId) : null);
            const nameFromMap = accountNameMap.get(boundId);
            const boundAccountName = boundId
                ? (nameFromMap != null ? nameFromMap : card.lastBoundAccountName || boundId)
                : (card.lastBoundAccountName || (displayId ? (accountNameMap.get(displayId) || displayId) : null));
            const uinFromMap = accountUinMap.get(boundId);
            const boundAccountUin = boundId
                ? (uinFromMap != null ? uinFromMap : (card.lastBoundAccountUin != null ? card.lastBoundAccountUin : null))
                : (card.lastBoundAccountUin != null ? card.lastBoundAccountUin : (displayId ? accountUinMap.get(displayId) : null));
            res.json({ ok: true, data: { ...card, boundAccountName, boundAccountUin } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/cards/batch', requireAdmin, (req, res) => {
        try {
            const body = req.body || {};
            const type = String(body.type || 'month').toLowerCase();
            const count = Math.min(1000, Math.max(1, Number.parseInt(body.count, 10) || 1));
            const prefix = String(body.prefix || '').trim();
            const remark = String(body.remark || '').trim();
            const created = cardsModel.createCards({ type, count, prefix, remark });
            res.json({ ok: true, data: created });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.patch('/api/cards/:id', requireAdmin, (req, res) => {
        try {
            const id = (req.params.id || '').toString().trim();
            const body = req.body || {};
            const updates = {};
            if (body.remark !== undefined) updates.remark = String(body.remark || '').trim();
            const card = cardsModel.updateCard(id, updates);
            if (!card) return res.status(404).json({ ok: false, error: '卡密不存在' });
            res.json({ ok: true, data: card });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.delete('/api/cards/:id', requireAdmin, (req, res) => {
        try {
            const id = (req.params.id || '').toString().trim();
            const card = cardsModel.getCardById(id);
            if (!card) return res.status(404).json({ ok: false, error: '卡密不存在' });
            const boundId = card.boundAccountId ? String(card.boundAccountId).trim() : '';
            const deleted = cardsModel.deleteCard(id);
            if (!deleted) return res.status(404).json({ ok: false, error: '卡密不存在' });
            if (boundId) {
                try {
                    if (card.status === 'banned' && typeof setAccountLoginDisabled === 'function') {
                        setAccountLoginDisabled(boundId, false);
                    }
                    if (provider && typeof provider.stopAccount === 'function') {
                        provider.stopAccount(boundId);
                    }
                } catch (subErr) {
                    adminLogger.warn('[卡密删除] 解绑/停用账号时异常，卡密已删除', { boundId, err: subErr && subErr.message });
                }
            }
            res.json({ ok: true, data: deleted });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/cards/:id/ban', requireAdmin, (req, res) => {
        try {
            const id = (req.params.id || '').toString().trim();
            const card = cardsModel.banCard(id);
            if (!card) return res.status(404).json({ ok: false, error: '卡密不存在' });
            const boundId = card.boundAccountId ? String(card.boundAccountId).trim() : '';
            if (boundId) {
                setAccountLoginDisabled(boundId, true);
                if (provider && provider.stopAccount) provider.stopAccount(boundId);
            }
            res.json({ ok: true, data: card });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/cards/:id/unban', requireAdmin, (req, res) => {
        try {
            const id = (req.params.id || '').toString().trim();
            const card = cardsModel.unbanCard(id);
            if (!card) return res.status(404).json({ ok: false, error: '卡密不存在' });
            const boundId = card.boundAccountId ? String(card.boundAccountId).trim() : '';
            if (boundId) setAccountLoginDisabled(boundId, false);
            res.json({ ok: true, data: card });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/cards/:id/force-logout', requireAdmin, (req, res) => {
        try {
            const id = (req.params.id || '').toString().trim();
            const card = cardsModel.getCardById(id);
            if (!card) return res.status(404).json({ ok: false, error: '卡密不存在' });
            const boundId = card.boundAccountId ? String(card.boundAccountId).trim() : '';
            if (boundId && provider && provider.stopAccount) provider.stopAccount(boundId);
            res.json({ ok: true, data: card });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/cards/:id/unbind', requireAdmin, (req, res) => {
        try {
            const id = (req.params.id || '').toString().trim();
            const existing = cardsModel.getCardById(id);
            if (!existing) return res.status(404).json({ ok: false, error: '卡密不存在' });
            const boundId = existing.boundAccountId ? String(existing.boundAccountId).trim() : '';
            if (boundId && provider && typeof provider.stopAccount === 'function') {
                provider.stopAccount(boundId);
            }
            const card = cardsModel.unbindAccount(id);
            if (!card) return res.status(404).json({ ok: false, error: '卡密不存在' });
            res.json({ ok: true, data: card });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 添加账号成功后激活卡密并绑定账号
    app.post('/api/cards/activate', (req, res) => {
        try {
            const body = req.body || {};
            const code = (body.code || '').toString().trim();
            const accountId = (body.accountId || '').toString().trim();
            if (!code || !accountId) {
                return res.status(400).json({ ok: false, error: '缺少 code 或 accountId' });
            }
            const { accounts } = store.getAccounts ? store.getAccounts() : { accounts: [] };
            const acc = (accounts || []).find(a => String(a.id) === String(accountId));
            const displayName = acc ? ((acc.name && String(acc.name).trim()) || (acc.nick && String(acc.nick).trim()) || (acc.uin && String(acc.uin)) || accountId) : accountId;
            const displayUin = acc && acc.uin != null ? String(acc.uin).trim() : null;
            const card = cardsModel.activateCard(code, accountId, {
                lastBoundAccountName: displayName,
                lastBoundAccountUin: displayUin,
            });
            res.json({ ok: true, data: card });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    // API: 日志（按登录用户隔离：仅能查看本人账号的日志）
    app.get('/api/logs', (req, res) => {
        const queryAccountIdRaw = (req.query.accountId || '').toString().trim();
        const userAccountIds = new Set(getAccountListForUser(req.tokenUser && req.tokenUser.userId).map(a => String(a.id)));
        let id;
        if (queryAccountIdRaw === 'all') {
            id = '';
        } else if (queryAccountIdRaw) {
            const resolved = resolveAccId(queryAccountIdRaw);
            if (!resolved || !userAccountIds.has(String(resolved))) {
                return res.status(403).json({ ok: false, error: '无权访问该账号' });
            }
            id = resolved;
        } else {
            id = getAccIdOrRespond(req, res);
            if (id === null) return;
        }
        const options = {
            limit: Number.parseInt(req.query.limit) || 100,
            tag: req.query.tag || '',
            module: req.query.module || '',
            event: req.query.event || '',
            keyword: req.query.keyword || '',
            isWarn: req.query.isWarn,
            timeFrom: req.query.timeFrom || '',
            timeTo: req.query.timeTo || '',
        };
        let list = provider.getLogs(id, options);
        if (id === '') {
            list = (Array.isArray(list) ? list : []).filter(entry => userAccountIds.has(String(entry.accountId || '')));
        }
        res.json({ ok: true, data: list });
    });

    // ============ QR Code Login APIs (无需账号选择) ============
    // 这些接口不需要 authRequired 也能调用（用于登录流程）
    app.post('/api/qr/create', async (req, res) => {
        try {
            const result = await MiniProgramLoginSession.requestLoginCode();
            res.json({ ok: true, data: result });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/qr/check', async (req, res) => {
        const { code } = req.body || {};
        if (!code) {
            return res.status(400).json({ ok: false, error: 'Missing code' });
        }

        try {
            const result = await MiniProgramLoginSession.queryStatus(code);

            if (result.status === 'OK') {
                const ticket = result.ticket;
                const uin = result.uin || '';
                const nickname = result.nickname || ''; // 获取昵称
                const appid = '1112386029'; // Farm appid

                const authCode = await MiniProgramLoginSession.getAuthCode(ticket, appid);

                let avatar = '';
                if (uin) {
                    avatar = `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=640`;
                }

                res.json({ ok: true, data: { status: 'OK', code: authCode, uin, avatar, nickname } });
            } else if (result.status === 'Used') {
                res.json({ ok: true, data: { status: 'Used' } });
            } else if (result.status === 'Wait') {
                res.json({ ok: true, data: { status: 'Wait' } });
            } else {
                res.json({ ok: true, data: { status: 'Error', error: result.msg } });
            }
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // 静态资源与 SPA：放在所有 /api 路由之后，确保 /api/* 由上面处理
    if (fs.existsSync(webDist)) {
        app.use(express.static(webDist));
    }
    app.use('/game-config', express.static(getResourcePath('gameConfig'), {
        maxAge: '7d',
        immutable: true,
    }));

    app.get('*', (req, res) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/game-config')) {
             return res.status(404).json({ ok: false, error: 'Not Found' });
        }
        if (fs.existsSync(webDist)) {
            res.sendFile(path.join(webDist, 'index.html'));
        } else {
            res.status(404).send('web build not found. Please build the web project.');
        }
    });

    const applySocketSubscription = (socket, accountRef = '') => {
        const incoming = String(accountRef || '').trim();
        const resolved = incoming && incoming !== 'all' ? resolveAccId(incoming) : '';
        for (const room of socket.rooms) {
            if (room.startsWith('account:')) socket.leave(room);
        }
        if (resolved) {
            socket.join(`account:${resolved}`);
            socket.data.accountId = resolved;
        } else {
            socket.join('account:all');
            socket.data.accountId = '';
        }
        socket.emit('subscribed', { accountId: socket.data.accountId || 'all' });

        try {
            const targetId = socket.data.accountId || '';
            const userId = socket.data.userId;
            const userAccountIds = (userId && getAccountListForUser(userId) || []).map(a => String(a.id));

            if (targetId && provider && typeof provider.getStatus === 'function') {
                const owns = userAccountIds.includes(targetId);
                if (owns) {
                    const currentStatus = provider.getStatus(targetId);
                    socket.emit('status:update', { accountId: targetId, status: currentStatus });
                }
            }
            if (provider && typeof provider.getLogs === 'function') {
                let currentLogs = provider.getLogs(targetId, { limit: 80 });
                if (targetId === '') {
                    currentLogs = (Array.isArray(currentLogs) ? currentLogs : []).filter(
                        entry => userAccountIds.includes(String(entry.accountId || ''))
                    );
                }
                socket.emit('logs:snapshot', {
                    accountId: targetId || 'all',
                    logs: Array.isArray(currentLogs) ? currentLogs : [],
                });
            }
            if (provider && typeof provider.getAccountLogs === 'function') {
                let currentAccountLogs = provider.getAccountLogs(80);
                currentAccountLogs = (Array.isArray(currentAccountLogs) ? currentAccountLogs : []).filter(
                    entry => userAccountIds.includes(String(entry.accountId || ''))
                );
                socket.emit('account-logs:snapshot', {
                    logs: Array.isArray(currentAccountLogs) ? currentAccountLogs : [],
                });
            }
        } catch {
            // ignore snapshot push errors
        }
    };

    const port = CONFIG.adminPort || 3000;
    server = app.listen(port, '0.0.0.0', () => {
        adminLogger.info('admin panel started', { url: `http://localhost:${port}`, port });
    });

    io = new SocketIOServer(server, {
        path: '/socket.io',
        cors: {
            origin: '*',
            methods: ['GET', 'POST'],
            allowedHeaders: ['x-admin-token', 'x-account-id'],
        },
    });

    io.use((socket, next) => {
        const authToken = socket.handshake.auth && socket.handshake.auth.token
            ? String(socket.handshake.auth.token)
            : '';
        const headerToken = socket.handshake.headers && socket.handshake.headers['x-admin-token']
            ? String(socket.handshake.headers['x-admin-token'])
            : '';
        const token = authToken || headerToken;
        if (!token || !tokenData.has(token)) {
            return next(new Error('Unauthorized'));
        }
        const userInfo = tokenData.get(token);
        socket.data.adminToken = token;
        socket.data.userId = userInfo ? userInfo.userId : '';
        return next();
    });

    io.on('connection', (socket) => {
        const initialAccountRef = (socket.handshake.auth && socket.handshake.auth.accountId)
            || (socket.handshake.query && socket.handshake.query.accountId)
            || '';
        applySocketSubscription(socket, initialAccountRef);
        socket.emit('ready', { ok: true, ts: Date.now() });

        socket.on('subscribe', (payload) => {
            const body = (payload && typeof payload === 'object') ? payload : {};
            applySocketSubscription(socket, body.accountId || '');
        });
    });
}

module.exports = {
    startAdminServer,
    emitRealtimeStatus,
    emitRealtimeLog,
    emitRealtimeAccountLog,
};
