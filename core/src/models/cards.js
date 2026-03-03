/**
 * 卡密存储与生命周期管理
 * 支持：天卡、周卡、月卡、年卡、永久卡
 * 状态：正常、封禁、过期；绑定账号/设备；修改有效期、解除绑定
 */

const crypto = require('node:crypto');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('../services/json-db');

const CARDS_FILE = getDataFile('cards.json');

const CARD_TYPES = {
  day: { label: '天卡', days: 1 },
  week: { label: '周卡', days: 7 },
  month: { label: '月卡', days: 30 },
  year: { label: '年卡', days: 365 },
  permanent: { label: '永久卡', days: null },
};

const STATUS_ACTIVE = 'active';
const STATUS_BANNED = 'banned';
const STATUS_EXPIRED = 'expired';

function generateCode(prefix = '') {
  const segment = () => crypto.randomBytes(4).toString('hex').toUpperCase();
  const part = `${segment()}-${segment()}-${segment()}`;
  return prefix ? `${String(prefix).trim().toUpperCase()}-${part}` : part;
}

function loadCardsRaw() {
  ensureDataDir();
  const data = readJsonFile(CARDS_FILE, () => ({ cards: [], nextId: 1 }));
  const cards = Array.isArray(data.cards) ? data.cards : [];
  let nextId = Number.parseInt(data.nextId, 10);
  if (!Number.isFinite(nextId) || nextId < 1) {
    nextId = cards.reduce((m, c) => Math.max(m, Number.parseInt(c.id, 10) || 0), 0) + 1;
  }
  return { cards, nextId };
}

function saveCardsRaw(data) {
  ensureDataDir();
  const normalized = {
    cards: Array.isArray(data.cards) ? data.cards : [],
    nextId: Number.isFinite(data.nextId) ? data.nextId : 1,
  };
  writeJsonFileAtomic(CARDS_FILE, normalized);
  return normalized;
}

function normalizeCard(c) {
  if (!c || typeof c !== 'object') return null;
  const type = c.type in CARD_TYPES ? c.type : 'month';
  const days = type === 'permanent' ? null : (CARD_TYPES[type].days ?? 30);
  const now = Date.now();
  let expiresAt = c.expiresAt != null ? Number(c.expiresAt) : null;
  if (type !== 'permanent' && c.activatedAt != null && expiresAt == null) {
    expiresAt = Number(c.activatedAt) + (days || 0) * 24 * 60 * 60 * 1000;
  }
  const status = c.status === STATUS_BANNED ? STATUS_BANNED
    : (expiresAt != null && expiresAt < now) ? STATUS_EXPIRED
      : STATUS_ACTIVE;
  return {
    id: String(c.id || ''),
    code: String(c.code || '').trim(),
    type,
    days,
    createdAt: Number(c.createdAt) || now,
    activatedAt: c.activatedAt != null ? Number(c.activatedAt) : null,
    expiresAt,
    boundAccountId: c.boundAccountId != null ? String(c.boundAccountId) : null,
    boundDeviceId: c.boundDeviceId != null ? String(c.boundDeviceId) : null,
    /** 曾绑定过的账号 ID（解绑后保留，用于永久显示绑定信息） */
    lastBoundAccountId: c.lastBoundAccountId != null ? String(c.lastBoundAccountId) : null,
    lastBoundAccountName: c.lastBoundAccountName != null ? String(c.lastBoundAccountName) : null,
    lastBoundAccountUin: c.lastBoundAccountUin != null ? String(c.lastBoundAccountUin) : null,
    /** 免费领取卡：领取该卡的网站用户 ID（与网站登录账号关联） */
    claimedByUserId: c.claimedByUserId != null ? String(c.claimedByUserId).trim() : null,
    /** 免费领取卡：领取该卡的网站用户名，用于卡密列表展示 */
    claimedByUsername: c.claimedByUsername != null ? String(c.claimedByUsername).trim() : null,
    status,
    lastUsedAt: c.lastUsedAt != null ? Number(c.lastUsedAt) : null,
    remark: String(c.remark || '').trim(),
  };
}

function getCards(filters = {}) {
  const { cards } = loadCardsRaw();
  let list = cards.map(normalizeCard).filter(Boolean);
  if (filters.status) {
    const s = String(filters.status).toLowerCase();
    list = list.filter(c => c.status === s);
  }
  if (filters.type) {
    const t = String(filters.type).toLowerCase();
    list = list.filter(c => c.type === t);
  }
  if (filters.search) {
    const q = String(filters.search).trim().toLowerCase();
    list = list.filter(c =>
      (c.code && c.code.toLowerCase().includes(q))
      || (c.boundAccountId && c.boundAccountId.toLowerCase().includes(q))
      || (c.remark && c.remark.toLowerCase().includes(q)),
    );
  }
  return list;
}

function getCardById(id) {
  const { cards } = loadCardsRaw();
  const c = cards.find(x => String(x.id) === String(id));
  return c ? normalizeCard(c) : null;
}

function getCardByCode(code) {
  const { cards } = loadCardsRaw();
  const raw = String(code || '').trim();
  const c = cards.find(x => String(x.code).trim() === raw);
  return c ? normalizeCard(c) : null;
}

/** 根据绑定的账号 ID 获取卡密（返回第一条，兼容旧逻辑） */
function getCardByBoundAccountId(accountId) {
  const list = getCardsByBoundAccountId(accountId);
  return list.length > 0 ? list[0] : null;
}

/** 根据绑定的账号 ID 获取该账号绑定的全部卡密（支持一账号多卡、到期叠加） */
function getCardsByBoundAccountId(accountId) {
  const { cards } = loadCardsRaw();
  const id = String(accountId || '').trim();
  if (!id) return [];
  return cards
    .filter(x => String(x.boundAccountId || '').trim() === id)
    .map(c => normalizeCard(c))
    .filter(Boolean);
}

/** 账号绑定卡密的汇总信息（多卡时到期时间按时长叠加：最早激活时间 + 所有卡密天数之和，例：天卡+月卡=31天，两月卡=60天） */
function getAccountEffectiveCardInfo(accountId) {
  const list = getCardsByBoundAccountId(accountId);
  if (list.length === 0) return null;
  const hasPermanent = list.some(c => c.expiresAt == null || c.days == null);
  let effectiveExpiresAt = null;
  if (!hasPermanent) {
    const minActivatedAt = Math.min(...list.map(c => c.activatedAt).filter(t => t != null));
    const totalDays = list.reduce((sum, c) => sum + (c.days != null ? c.days : 0), 0);
    if (Number.isFinite(minActivatedAt) && totalDays >= 0) {
      effectiveExpiresAt = minActivatedAt + totalDays * 24 * 60 * 60 * 1000;
    } else {
      effectiveExpiresAt = Math.max(...list.map(c => c.expiresAt).filter(t => t != null));
    }
  }
  const code = list.length === 1 ? list[0].code : '多张卡密';
  const type = hasPermanent ? 'permanent' : (list.length > 1 ? 'multiple' : list[0].type);
  return {
    code,
    type,
    expiresAt: effectiveExpiresAt,
    cardCount: list.length,
  };
}

function createCards(options = {}) {
  const { type = 'month', count = 1, prefix = '', remark = '' } = options;
  if (!(type in CARD_TYPES)) throw new Error(`无效卡类型: ${type}`);
  const days = CARD_TYPES[type].days;
  const data = loadCardsRaw();
  const created = [];
  const codeSet = new Set(data.cards.map(c => c.code));
  for (let i = 0; i < count; i++) {
    let code = generateCode(prefix);
    while (codeSet.has(code)) code = generateCode(prefix);
    codeSet.add(code);
    const id = String(data.nextId++);
    const card = normalizeCard({
      id,
      code,
      type,
      days,
      createdAt: Date.now(),
      activatedAt: null,
      expiresAt: null,
      boundAccountId: null,
      boundDeviceId: null,
      status: STATUS_ACTIVE,
      remark: String(remark).trim(),
    });
    data.cards.push(card);
    created.push(card);
  }
  saveCardsRaw(data);
  return created;
}

function updateCard(id, updates) {
  const data = loadCardsRaw();
  const idx = data.cards.findIndex(c => String(c.id) === String(id));
  if (idx < 0) return null;
  const next = { ...data.cards[idx], ...updates };
  data.cards[idx] = normalizeCard(next);
  saveCardsRaw(data);
  return data.cards[idx];
}

function banCard(id) {
  return updateCard(id, { status: STATUS_BANNED });
}

function unbanCard(id) {
  const card = getCardById(id);
  if (!card) return null;
  const status = card.expiresAt != null && card.expiresAt < Date.now() ? STATUS_EXPIRED : STATUS_ACTIVE;
  return updateCard(id, { status });
}

function setCardExpiry(id, expiresAt) {
  return updateCard(id, { expiresAt: expiresAt == null ? null : Number(expiresAt) });
}

function unbindDevice(id) {
  return updateCard(id, { boundDeviceId: null, lastUsedAt: null });
}

/**
 * 解除卡密与账号的绑定：清除绑定信息、曾绑定信息、到期时间，并置为未激活状态；解绑后卡密可再次被激活使用。
 * 同时保证：该卡解绑前绑定的 QQ 在「添加账号-验证QQ号」时会被判为未激活，需输入卡密才能扫码（因 lastBound* 与 activatedAt 已清空，findValidCardByLastBoundUin 不会命中）。
 */
function unbindAccount(id) {
  return updateCard(id, {
    boundAccountId: null,
    boundDeviceId: null,
    lastUsedAt: null,
    activatedAt: null,
    expiresAt: null,
    lastBoundAccountId: null,
    lastBoundAccountName: null,
    lastBoundAccountUin: null,
  });
}

/**
 * 账号删除时：将该账号下所有已绑定卡密解绑，并写入 lastBound* 以便列表仍能显示 QQ/账号名
 */
function unbindCardsByAccountId(accountId, opts = {}) {
  const accountIdStr = String(accountId || '').trim();
  if (!accountIdStr) return 0;
  const accountName = opts.accountName != null ? String(opts.accountName).trim() : '';
  const accountUin = opts.accountUin != null ? String(opts.accountUin).trim() : '';
  const { cards } = loadCardsRaw();
  let count = 0;
  for (const c of cards) {
    if (String(c.boundAccountId || '').trim() !== accountIdStr) continue;
    updateCard(c.id, {
      boundAccountId: null,
      boundDeviceId: null,
      lastBoundAccountId: accountIdStr,
      lastBoundAccountName: accountName || null,
      lastBoundAccountUin: accountUin || null,
    });
    count++;
  }
  return count;
}

/**
 * 根据 lastBoundAccountUin 查找曾激活且未过期的卡密（用于该 QQ 再次添加时跳过卡密并自动绑定）
 * 不要求当前未绑定：账号已移除时卡密仍可能 boundAccountId 指向已删账号，只要未过期即算有效
 */
function findValidCardByLastBoundUin(uin) {
  const u = String(uin || '').trim();
  if (!u) return null;
  const { cards } = loadCardsRaw();
  for (const c of cards) {
    const card = normalizeCard(c);
    if (!card) continue;
    if (card.status !== STATUS_ACTIVE) continue;
    if (card.activatedAt == null) continue;
    const lastUin = card.lastBoundAccountUin != null ? String(card.lastBoundAccountUin).trim() : '';
    if (lastUin === u) return card;
  }
  return null;
}

/**
 * 将已激活的卡密重新绑定到新账号（QQ 移除后再添加时用）
 */
function rebindCardToAccount(cardId, accountId, opts = {}) {
  const card = getCardById(cardId);
  if (!card) return null;
  if (card.status === STATUS_EXPIRED || card.status === STATUS_BANNED) return null;
  const accountIdStr = String(accountId || '').trim();
  const accountName = opts.accountName != null ? String(opts.accountName).trim() : null;
  const accountUin = opts.accountUin != null ? String(opts.accountUin).trim() : null;
  return updateCard(cardId, {
    boundAccountId: accountIdStr,
    lastBoundAccountId: accountIdStr,
    lastBoundAccountName: accountName,
    lastBoundAccountUin: accountUin,
  });
}

/**
 * 删除卡密（从列表中移除）。删除后与该卡密绑定的 QQ 账号将不再绑定任何卡密。
 * @returns {object|null} 被删除的卡密（已标准化），不存在则返回 null
 */
function deleteCard(id) {
  const data = loadCardsRaw();
  const idx = data.cards.findIndex(c => String(c.id) === String(id));
  if (idx < 0) return null;
  const removed = data.cards.splice(idx, 1)[0];
  saveCardsRaw(data);
  return removed ? normalizeCard(removed) : null;
}

function getStats() {
  const { cards } = loadCardsRaw();
  const list = cards.map(normalizeCard).filter(Boolean);
  const total = list.length;
  const activated = list.filter(c => c.activatedAt != null).length;
  const active = list.filter(c => c.status === STATUS_ACTIVE).length;
  const banned = list.filter(c => c.status === STATUS_BANNED).length;
  const expired = list.filter(c => c.status === STATUS_EXPIRED).length;
  return {
    total,
    activated,
    active,
    banned,
    expired,
  };
}

/**
 * 验证卡密：是否存在、未封禁、未过期、未已被使用（添加账号前校验，已使用的卡密不能再次用于绑定新账号）
 * @returns {{ valid: boolean, message?: string, card?: object }}
 */
function verifyCard(code) {
  const raw = String(code || '').trim();
  if (!raw) return { valid: false, message: '请输入卡密' };
  const card = getCardByCode(raw);
  if (!card) return { valid: false, message: '卡密不存在' };
  if (card.status === STATUS_BANNED) return { valid: false, message: '卡密已封禁' };
  if (card.status === STATUS_EXPIRED) return { valid: false, message: '卡密已过期' };
  if (card.activatedAt != null) return { valid: false, message: '卡密已使用' };
  const now = Date.now();
  if (card.expiresAt != null && card.expiresAt < now) return { valid: false, message: '卡密已过期' };
  return {
    valid: true,
    card: {
      id: card.id,
      code: card.code,
      type: card.type,
      expiresAt: card.expiresAt,
      status: card.status,
      activatedAt: card.activatedAt,
    },
  };
}

/** 免费领取永久卡：每个网站登录用户最多可领取次数（与网站注册账号关联，非 QQ 账号） */
const FREE_CLAIM_LIMIT_PER_USER = 3;
const FREE_CLAIM_REMARK = '免费领取';

/**
 * 统计某网站用户已领取的免费永久卡数量（按 claimedByUserId + 备注「免费领取」统计）
 * @param {string} userId - 网站登录用户 ID
 */
function getFreeClaimCount(userId) {
  const id = String(userId || '').trim();
  if (!id) return 0;
  const { cards } = loadCardsRaw();
  return cards.filter(
    c => String(c.claimedByUserId || '').trim() === id && String(c.remark || '').trim() === FREE_CLAIM_REMARK,
  ).length;
}

/**
 * 为当前网站用户领取一张免费永久卡（与网站登录账号关联）；每用户限领 3 次；卡密写入列表，领取人信息用于展示。
 * 卡密未绑定 QQ 账号，用户可在添加/使用账号时输入该卡密进行绑定。
 * @param {string} userId - 网站登录用户 ID
 * @param {string} [username] - 网站用户名，用于卡密列表展示「领取用户」
 * @returns {object} 新卡密（未激活、未绑定，可后续使用）
 */
function claimFreePermanentCard(userId, username = '') {
  const userIdStr = String(userId || '').trim();
  if (!userIdStr) throw new Error('未登录');
  const count = getFreeClaimCount(userIdStr);
  if (count >= FREE_CLAIM_LIMIT_PER_USER) {
    throw new Error(`免费永久卡领取次数已达上限（${FREE_CLAIM_LIMIT_PER_USER} 次）`);
  }
  const created = createCards({
    type: 'permanent',
    count: 1,
    prefix: '',
    remark: FREE_CLAIM_REMARK,
  });
  if (!created || created.length === 0) throw new Error('生成卡密失败');
  const card = created[0];
  updateCard(card.id, {
    claimedByUserId: userIdStr,
    claimedByUsername: username != null ? String(username).trim() : '',
  });
  return getCardById(card.id);
}

/**
 * 激活卡密并绑定账号（添加账号成功后调用，或续费时绑定新卡）
 * @param {string} code - 卡密
 * @param {string} accountId - 账号 ID
 * @param {object} [options] - 可选：{ overrideExpiresAt: number|null } 续费时传入，用于叠加时长或设为永久
 */
function activateCard(code, accountId, options = {}) {
  const result = verifyCard(code);
  if (!result.valid) throw new Error(result.message || '卡密无效');
  const card = getCardById(result.card.id);
  if (card.activatedAt != null) throw new Error('卡密已使用');
  const now = Date.now();
  let expiresAt;
  if (options.overrideExpiresAt !== undefined) {
    expiresAt = options.overrideExpiresAt == null ? null : Number(options.overrideExpiresAt);
  } else if (card.type !== 'permanent' && card.days != null) {
    expiresAt = now + card.days * 24 * 60 * 60 * 1000;
  } else {
    expiresAt = null;
  }
  const accountIdStr = String(accountId || '');
  return updateCard(card.id, {
    activatedAt: now,
    expiresAt,
    boundAccountId: accountIdStr,
    lastBoundAccountId: accountIdStr,
    lastBoundAccountName: options.lastBoundAccountName != null ? String(options.lastBoundAccountName) : null,
    lastBoundAccountUin: options.lastBoundAccountUin != null ? String(options.lastBoundAccountUin) : null,
    lastUsedAt: now,
  });
}

module.exports = {
  CARD_TYPES,
  STATUS_ACTIVE,
  STATUS_BANNED,
  STATUS_EXPIRED,
  getCards,
  getCardById,
  getCardByCode,
  getCardByBoundAccountId,
  getCardsByBoundAccountId,
  getAccountEffectiveCardInfo,
  createCards,
  updateCard,
  banCard,
  unbanCard,
  setCardExpiry,
  unbindDevice,
  unbindAccount,
  deleteCard,
  getStats,
  verifyCard,
  activateCard,
  unbindCardsByAccountId,
  findValidCardByLastBoundUin,
  rebindCardToAccount,
  getFreeClaimCount,
  claimFreePermanentCard,
};
