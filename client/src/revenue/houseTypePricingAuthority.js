export function validateRepresentativeNia(value) {
  if (value == null || String(value).trim() === '') return '';
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    return 'Enter a positive NIA no greater than 100,000 square feet, or leave blank.';
  }
  return '';
}
