/**
 * BL-012A — CSV parsing for Purchase Ledger import.
 */

const ACCEPTED_EXTENSIONS = ['.csv'];
const ACCEPTED_MIME = ['text/csv', 'application/csv', 'text/plain'];

export function isAcceptedCsvFile(file) {
  if (!file) return false;
  const name = String(file.name || '').toLowerCase();
  if (ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  if (ACCEPTED_MIME.includes(file.type)) return true;
  return false;
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

export function parseCsvText(text) {
  const normalised = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalised.split('\n').filter((line) => line.length > 0);
  return lines.map(parseCsvLine);
}

export async function parseCsvFile(file) {
  const text = await file.text();
  return parseCsvText(text);
}

export function isBlankRow(values) {
  return (values || []).every((cell) => !String(cell || '').trim());
}

export function extractHeaders(row) {
  return (row || []).map((cell, index) => {
    const label = String(cell || '').trim();
    return label || `Column ${index + 1}`;
  });
}
