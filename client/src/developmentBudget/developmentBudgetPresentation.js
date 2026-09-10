const pounds = value => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Math.abs(Number(value || 0)));

export function signedMoney(value) {
  const amount = Number(value || 0);
  if (amount > 0) return `+${pounds(amount)}`;
  if (amount < 0) return `−${pounds(amount)}`;
  return pounds(0);
}

function formatCommercialDate(value) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '—';
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' }).format(date);
}

export function budgetHistoryRow(event) {
  const lines = event?.lines || [];
  const type = String(event?.eventType || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  const date = formatCommercialDate(event?.effectiveDate);
  if (event?.eventType === 'opening_budget') {
    const total = lines.reduce((sum, line) => sum + Number(line.signedAmount || 0), 0);
    return { date, type: 'Opening Budget', reference: event.reference, details: event.reason, effect: `${pounds(total)} baseline` };
  }
  if (event?.eventType === 'transfer') {
    const from = lines.find(line => Number(line.signedAmount) < 0);
    const to = lines.find(line => Number(line.signedAmount) > 0);
    const label = line => [line?.costCode, line?.description].filter(Boolean).join(' — ');
    return { date, type: 'Transfer', reference: event.reference, details: `${label(from)} → ${label(to)} · ${event.reason}`, effect: `${pounds(from?.signedAmount)} transferred` };
  }
  const line = lines[0];
  const detail = [[line?.costCode, line?.description].filter(Boolean).join(' — '), event?.reason].filter(Boolean).join(' · ');
  return { date, type, reference: event?.reference, details: detail, effect: signedMoney(lines.reduce((sum, item) => sum + Number(item.signedAmount || 0), 0)) };
}
