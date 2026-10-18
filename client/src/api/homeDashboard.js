const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/+$/, '');

export async function getHomeDashboard() {
  const response = await fetch(`${API_BASE}/api/home/dashboard`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || 'The Home dashboard could not be loaded.');
  return body;
}
