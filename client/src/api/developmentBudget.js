const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/+$/, '');

export class DevelopmentBudgetApiError extends Error {
  constructor(message, status = 0) {
    super(message || 'Development Budget request failed.');
    this.name = 'DevelopmentBudgetApiError';
    this.status = status;
  }
}

async function json(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new DevelopmentBudgetApiError(body.message, response.status);
  return body;
}

export async function getDevelopmentBudget(developmentId) {
  return json(await fetch(`${API_BASE}/api/developments/${encodeURIComponent(developmentId)}/budget-authority`));
}

export async function postDevelopmentBudgetEvent(developmentId, payload) {
  return json(await fetch(`${API_BASE}/api/developments/${encodeURIComponent(developmentId)}/budget-authority/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}
