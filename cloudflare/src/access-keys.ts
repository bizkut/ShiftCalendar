import type { JWTHeaderParameters } from 'jose';

type PublicKey = JsonWebKey & { kid?: string; alg?: string; use?: string };
type Snapshot = { fetchedAt: number; keys: PublicKey[]; imported: Map<PublicKey, CryptoKey> };

// This resolver is deliberately RS256-only. jwtVerify still verifies the JWS,
// key strength, issuer, audience, expiry and required identity claims.
export function createAccessKeyResolver(issuer: string) {
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer)) {
    throw new Error('Invalid Access issuer');
  }
  let snapshot: Snapshot | undefined;

  async function reload() {
    const response = await fetch(`${issuer}/cdn-cgi/access/certs`, {
      redirect: 'manual', signal: AbortSignal.timeout(5000),
    });
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel();
      throw new Error('Access keys unavailable');
    }
    // Bound the trusted endpoint's response as well as the retained key set.
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > 65536) throw new Error('Access key response too large');
        chunks.push(part.value);
      }
    } catch (error) {
      await reader.cancel();
      throw error;
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || !Array.isArray(value.keys) || value.keys.length > 16
        || value.keys.some((key: unknown) => !key || typeof key !== 'object' || Array.isArray(key))) {
      throw new Error('Invalid Access key set');
    }
    const next: Snapshot = { fetchedAt: Date.now(), keys: value.keys, imported: new Map() };
    // Cache only completed data/keys, never another request's pending fetch.
    snapshot = next;
    return next;
  }

  return async (header: JWTHeaderParameters): Promise<CryptoKey> => {
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid
        || header.kid.length > 256) throw new Error('Invalid Access key selector');
    let current = snapshot;
    if (!current || Date.now() - current.fetchedAt >= 600000) current = await reload();
    let matches = current.keys.filter(key => key.kid === header.kid);
    if (matches.length === 0 && Date.now() - current.fetchedAt >= 30000) {
      current = await reload();
      matches = current.keys.filter(key => key.kid === header.kid);
    }
    // Ambiguous IDs and private/non-signing keys fail closed.
    if (matches.length !== 1) throw new Error('Access key not found or ambiguous');
    const key = matches[0];
    if (key.kty !== 'RSA' || key.d !== undefined
        || (key.alg !== undefined && key.alg !== 'RS256')
        || (key.use !== undefined && key.use !== 'sig')
        || (key.ext !== undefined && typeof key.ext !== 'boolean')
        || (key.key_ops !== undefined && (!Array.isArray(key.key_ops)
          || !key.key_ops.includes('verify')
          || key.key_ops.some((op, index, all) => typeof op !== 'string' || all.indexOf(op) !== index)))) {
      throw new Error('Invalid Access verification key');
    }
    let imported = current.imported.get(key);
    if (!imported) {
      imported = await crypto.subtle.importKey('jwk', key,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      if (imported.type !== 'public') throw new Error('Access requires a public key');
      current.imported.set(key, imported);
    }
    return imported;
  };
}
