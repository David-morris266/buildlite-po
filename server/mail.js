// server/mail.js
const nodemailer = require('nodemailer');

const {
  SMTP_HOST, SMTP_PORT = 587, SMTP_USER, SMTP_PASS,
  FROM_EMAIL, APPROVER_EMAILS = ''
} = process.env;

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: Number(SMTP_PORT) === 465, // true for 465, false for 587/25
  auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
});

async function sendMail({ to, subject, text, html }) {
  if (!to) throw new Error('Missing "to"');
  const info = await transporter.sendMail({
    from: FROM_EMAIL || SMTP_USER,
    to,
    subject,
    text,
    html: html || `<pre>${text}</pre>`,
  });
  console.log('[MAIL] sent:', info.messageId, 'to:', to);
  return info;
}

function getApproverList() {
  return (APPROVER_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
}

module.exports = { sendMail, getApproverList };

