import type { ApiError, ApiResponse } from '../shared/cloudTypes';

export const cloudflareConfigured = process.env.EXPO_PUBLIC_CLOUD_PROVIDER === 'cloudflare';
export const sessionExpiredEvent = 'shiftcalendar:session-expired';

export class CloudApiError extends Error {
  readonly code: ApiError['code'];
  readonly details?: unknown;
  constructor(error: ApiError, public readonly status: number) {
    super(error.message);
    this.name = 'CloudApiError'; this.code = error.code; this.details = error.details;
  }
}
export function isCloudConfigured() { return cloudflareConfigured; }
export function createMutationId() { return crypto.randomUUID(); }
export function cloudErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The cloud request failed. Please try again.';
}

export async function cloudRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!cloudflareConfigured) throw new CloudApiError({ code: 'internal', message: 'Cloud API is not configured.' }, 0);
  if (!path.startsWith('/') || path.startsWith('//') || /[\\#]/.test(path)) throw new Error('Invalid API path.');
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  headers.set('X-ShiftCalendar-Request', '1');
  if (init.body) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`/v1${path}`, { ...init, headers, credentials: 'same-origin', redirect: 'manual', cache: 'no-store' });
  } catch {
    throw new CloudApiError({ code: 'internal', message: 'Could not reach the cloud service. Your change was not saved.' }, 0);
  }
  if (response.type === 'opaqueredirect' || response.status === 401 || response.status >= 300 && response.status < 400
      || response.headers.get('content-type')?.includes('text/html')) {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(sessionExpiredEvent));
    throw new CloudApiError({ code: 'unauthorized', message: 'Your session expired. Please sign in again.' }, 401);
  }
  const payload = await response.json().catch(() => ({})) as ApiResponse<T>;
  if (!response.ok || payload.error) throw new CloudApiError(payload.error ?? {
    code: 'internal', message: `Cloud request failed (${response.status}).`,
  }, response.status);
  if (payload.data === undefined) throw new CloudApiError({ code: 'internal', message: 'Cloud service returned an invalid response.' }, response.status);
  return payload.data;
}
