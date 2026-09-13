import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ApiError } from './errors';

// Cache only public verification keys, never request identity or session data.
const resolvers = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function verifyIdentity(request: Request, env: Env, onColdResolver?: () => void) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16384) throw new ApiError(401, 'unauthorized', 'Please sign in again.');
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER)
      || env.ACCESS_AUDIENCE === 'unconfigured' || !env.ACCESS_AUDIENCE) {
    throw new ApiError(503, 'unavailable', 'Cloud login is not configured.');
  }
  let resolver = resolvers.get(env.ACCESS_ISSUER);
  if (!resolver) {
    // Let the caller mark the response without initializing console formatting.
    onColdResolver?.();
    resolver = createRemoteJWKSet(new URL(`${env.ACCESS_ISSUER}/cdn-cgi/access/certs`), {
      timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 600000,
    });
    if (resolvers.size >= 4) resolvers.clear();
    resolvers.set(env.ACCESS_ISSUER, resolver);
  }
  try {
    const { payload } = await jwtVerify(token, resolver, {
      algorithms: ['RS256'], issuer: env.ACCESS_ISSUER, audience: env.ACCESS_AUDIENCE,
      requiredClaims: ['sub', 'exp', 'iat', 'email'],
    });
    if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 256
        || typeof payload.email !== 'string' || payload.email.length > 254) throw new Error('Invalid identity');
    return { sub: payload.sub, username: payload.email };
  } catch {
    throw new ApiError(401, 'unauthorized', 'Please sign in again.');
  }
}

export function requireSameOrigin(request: Request, env: Env) {
  if (['GET', 'HEAD'].includes(request.method)) return;
  // Exact Origin plus a non-simple custom header prevents cross-site form writes.
  if (request.headers.get('Origin') !== env.APP_ORIGIN
      || new URL(request.url).origin !== env.APP_ORIGIN
      || request.headers.get('X-ShiftCalendar-Request') !== '1') {
    throw new ApiError(403, 'forbidden', 'Request origin is not allowed.');
  }
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') {
    throw new ApiError(415, 'invalid_request', 'JSON is required.');
  }
}
