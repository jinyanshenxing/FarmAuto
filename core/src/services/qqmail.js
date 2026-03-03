const nodemailer = require('nodemailer');

function assertText(name, value) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${name} 不能为空`);
  return text;
}

function normalizeQqMailAddress(addr) {
  const text = String(addr || '').trim();
  if (!text) return '';
  // Allow "123@qq.com" or plain "123"
  if (text.includes('@')) return text;
  if (/^\d{4,13}$/.test(text)) return `${text}@qq.com`;
  return text;
}

/**
 * QQ邮箱 SMTP 发送（需要开启 SMTP 并使用授权码）
 * @param {object} payload
 * @param {string} payload.from 发件人邮箱（如 12345678@qq.com）
 * @param {string} payload.authCode QQ邮箱 SMTP 授权码
 * @param {string} payload.to 收件人邮箱（如 87654321@qq.com 或纯QQ号）
 * @param {string} payload.subject 标题
 * @param {string} payload.text 正文
 */
async function sendQqMail(payload = {}) {
  const from = assertText('from', payload.from);
  const authCode = assertText('authCode', payload.authCode);
  const toRaw = assertText('to', payload.to);
  const to = normalizeQqMailAddress(toRaw);
  const subject = assertText('subject', payload.subject);
  const text = assertText('text', payload.text);

  const transporter = nodemailer.createTransport({
    host: 'smtp.qq.com',
    port: 465,
    secure: true,
    auth: {
      user: from,
      pass: authCode,
    },
  });

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text,
  });

  return { ok: true, messageId: info && info.messageId ? String(info.messageId) : '' };
}

module.exports = {
  sendQqMail,
  normalizeQqMailAddress,
};

