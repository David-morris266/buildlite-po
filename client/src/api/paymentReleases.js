const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/+$/, '');
async function json(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || 'Payment Release request failed.');
  return body;
}
export async function getPaymentReleaseQueue() {
  return (await json(await fetch(`${API_BASE}/api/payment-releases/queue`))).items || [];
}
export async function releasePayments(payload) {
  return json(await fetch(`${API_BASE}/api/payment-releases/batches`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }));
}
