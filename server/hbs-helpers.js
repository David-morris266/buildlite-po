// server/hbs-helpers.js
const Handlebars = require('handlebars');

Handlebars.registerHelper('formatMoney', (v, currency) => {
  const n = Number(v ?? 0);
  const code = currency || 'GBP';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: code, minimumFractionDigits: 2 }).format(n);
});

Handlebars.registerHelper('formatQty', (v) => {
  const n = Number(v ?? 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
});

Handlebars.registerHelper('formatDate', (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
});

Handlebars.registerHelper('formatDateTime', (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
});

module.exports = Handlebars;
