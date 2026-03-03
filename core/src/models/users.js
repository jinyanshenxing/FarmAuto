/**
 * 登录用户存储：管理员与普通用户，共用登录页
 * 注册用户统一为普通用户
 */

const crypto = require('node:crypto');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('../services/json-db');

const USERS_FILE = getDataFile('users.json');
const ROLES = { admin: 'admin', user: 'user' };

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(String(pwd || '')).digest('hex');
}

function loadUsersRaw() {
  ensureDataDir();
  const data = readJsonFile(USERS_FILE, () => ({ users: [], nextId: 1 }));
  const users = Array.isArray(data.users) ? data.users : [];
  let nextId = Number.parseInt(data.nextId, 10);
  if (!Number.isFinite(nextId) || nextId < 1) {
    nextId = Math.max(1, ...users.map(u => Number(u.id) || 0)) + 1;
  }
  return { users, nextId };
}

function saveUsersRaw(data) {
  ensureDataDir();
  const out = {
    users: Array.isArray(data.users) ? data.users : [],
    nextId: Number.isFinite(data.nextId) ? data.nextId : 1,
  };
  writeJsonFileAtomic(USERS_FILE, out);
  return out;
}

/** 若尚无用户且存在旧版管理密码，则创建默认 admin 用户 */
function ensureLegacyAdmin(store) {
  const { users } = loadUsersRaw();
  if (users.length > 0) return;
  const hash = store && typeof store.getAdminPasswordHash === 'function' ? store.getAdminPasswordHash() : '';
  if (!hash) return;
  const admin = {
    id: 1,
    username: 'admin',
    passwordHash: hash,
    role: ROLES.admin,
    createdAt: Date.now(),
    banned: false,
  };
  saveUsersRaw({ users: [admin], nextId: 2 });
}

function findUserByUsername(username) {
  const raw = String(username || '').trim().toLowerCase();
  if (!raw) return null;
  const { users } = loadUsersRaw();
  return users.find(u => String(u.username || '').trim().toLowerCase() === raw) || null;
}

function validateUser(username, password) {
  const user = findUserByUsername(username);
  if (!user || !user.passwordHash) return null;
  if (user.banned === true) return null;
  const hash = hashPassword(password);
  if (hash !== user.passwordHash) return null;
  return { id: user.id, username: user.username, role: user.role || ROLES.user };
}

function createUser(username, password, role = ROLES.user) {
  const name = String(username || '').trim();
  if (!name) throw new Error('用户名为空');
  if (name.length < 2) throw new Error('用户名至少 2 个字符');
  if (findUserByUsername(name)) throw new Error('用户名已存在');
  const pwd = String(password || '');
  if (pwd.length < 4) throw new Error('密码至少 4 位');

  const data = loadUsersRaw();
  const id = data.nextId++;
  const user = {
    id,
    username: name,
    passwordHash: hashPassword(pwd),
    role: role === ROLES.admin ? ROLES.admin : ROLES.user,
    createdAt: Date.now(),
    banned: false,
  };
  data.users.push(user);
  saveUsersRaw(data);
  return { id: user.id, username: user.username, role: user.role };
}

function findUserById(id) {
  const raw = Number(id);
  if (!Number.isFinite(raw)) return null;
  const { users } = loadUsersRaw();
  return users.find(u => Number(u.id) === raw) || null;
}

function changePassword(userId, oldPassword, newPassword) {
  const user = findUserById(userId);
  if (!user) throw new Error('用户不存在');
  if (hashPassword(oldPassword) !== user.passwordHash) throw new Error('原密码错误');
  const pwd = String(newPassword || '');
  if (pwd.length < 4) throw new Error('新密码至少 4 位');
  const data = loadUsersRaw();
  const idx = data.users.findIndex(u => Number(u.id) === Number(userId));
  if (idx < 0) throw new Error('用户不存在');
  data.users[idx] = { ...data.users[idx], passwordHash: hashPassword(pwd) };
  saveUsersRaw(data);
  return true;
}

/** 管理员直接设置用户新密码（无需原密码） */
function adminSetPassword(userId, newPassword) {
  const user = findUserById(userId);
  if (!user) throw new Error('用户不存在');
  const pwd = String(newPassword || '');
  if (pwd.length < 4) throw new Error('新密码至少 4 位');
  const data = loadUsersRaw();
  const idx = data.users.findIndex(u => Number(u.id) === Number(userId));
  if (idx < 0) throw new Error('用户不存在');
  data.users[idx] = { ...data.users[idx], passwordHash: hashPassword(pwd) };
  saveUsersRaw(data);
  return true;
}

/** 列出所有用户（用于管理员），返回账号、注册时间等，密码以 **** 占位 */
function listAllUsers() {
  const { users } = loadUsersRaw();
  return users.map(u => ({
    id: u.id,
    username: u.username || '',
    password: '****',
    createdAt: u.createdAt != null ? Number(u.createdAt) : null,
    role: u.role || ROLES.user,
    banned: u.banned === true,
  }));
}

/** 删除用户（仅从用户表移除，不解除该用户下账号与卡密的绑定、不改变卡密使用状态） */
function deleteUser(userId) {
  const data = loadUsersRaw();
  const idx = data.users.findIndex(u => Number(u.id) === Number(userId));
  if (idx < 0) throw new Error('用户不存在');
  data.users.splice(idx, 1);
  saveUsersRaw(data);
  return true;
}

/** 封禁/解封用户（禁止/允许登录），不解除账号与卡密绑定、不改变卡密状态 */
function setUserBanned(userId, banned) {
  const data = loadUsersRaw();
  const idx = data.users.findIndex(u => Number(u.id) === Number(userId));
  if (idx < 0) throw new Error('用户不存在');
  data.users[idx] = { ...data.users[idx], banned: !!banned };
  saveUsersRaw(data);
  return true;
}

module.exports = {
  ROLES,
  loadUsersRaw,
  ensureLegacyAdmin,
  findUserByUsername,
  findUserById,
  validateUser,
  createUser,
  changePassword,
  adminSetPassword,
  listAllUsers,
  deleteUser,
  setUserBanned,
  hashPassword,
};
