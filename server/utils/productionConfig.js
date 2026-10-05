function requireValue(env, name, errors) {
  const value = String(env[name] || '').trim();
  if (!value) errors.push(`${name} is required in production.`);
  return value;
}

function validateHttpsOrigin(value, name, errors) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('not a canonical HTTPS origin');
  } catch {
    errors.push(`${name} must be an absolute HTTPS origin.`);
  }
}

function validateProductionConfig(env = process.env) {
  if (env.NODE_ENV !== 'production') return { ok: true, errors: [] };
  const errors = [];
  requireValue(env, 'DATABASE_URL', errors);
  requireValue(env, 'CLERK_SECRET_KEY', errors);
  requireValue(env, 'CLERK_PUBLISHABLE_KEY', errors);
  const appUrl = requireValue(env, 'BUILDLITE_APP_URL', errors);
  const corsValue = requireValue(env, 'CORS_ALLOWED_ORIGINS', errors);
  if (env.BUILDLITE_SERVER_TEST === '1') errors.push('BUILDLITE_SERVER_TEST must not be enabled in production.');
  if (env.TEST_DATABASE_URL) errors.push('TEST_DATABASE_URL must not be configured in production.');
  if (env.BUILDLITE_STRICT_SERVICE_AUTH === '0') errors.push('Service authorization must not be relaxed in production.');
  if (env.DATABASE_SSL && !['true', 'false'].includes(env.DATABASE_SSL)) errors.push('DATABASE_SSL must be true or false.');
  if (appUrl) validateHttpsOrigin(appUrl, 'BUILDLITE_APP_URL', errors);
  if (corsValue) {
    const origins = corsValue.split(',').map((item) => item.trim()).filter(Boolean);
    if (!origins.length || origins.includes('*')) errors.push('CORS_ALLOWED_ORIGINS must contain explicit origins.');
    for (const origin of origins) validateHttpsOrigin(origin, 'Each CORS_ALLOWED_ORIGINS entry', errors);
  }
  return { ok: errors.length === 0, errors };
}

function assertProductionConfig(env = process.env) {
  const result = validateProductionConfig(env);
  if (!result.ok) {
    const error = new Error(`Production configuration is invalid:\n- ${result.errors.join('\n- ')}`);
    error.code = 'INVALID_PRODUCTION_CONFIGURATION';
    throw error;
  }
  return result;
}

module.exports = { validateProductionConfig, assertProductionConfig };
