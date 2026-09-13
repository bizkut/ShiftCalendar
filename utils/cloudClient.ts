import { fetchAuthSession } from 'aws-amplify/auth';
import type { ApiError, ApiResponse } from '../shared/cloudTypes';

const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');

export class CloudApiError extends Error {
  readonly code: ApiError['code'];
  readonly details?: unknown;
  readonly status: number;

  constructor(error: ApiError, status: number) {
    super(error.message);
    this.name = 'CloudApiError';
    this.code = error.code;
    this.details = error.details;
    this.status = status;
  }
}

export function isCloudConfigured(): boolean {
  return Boolean(
    process.env.EXPO_PUBLIC_CLOUD_PROVIDER !== 'cloudflare' && API_URL &&
      process.env.EXPO_PUBLIC_COGNITO_DOMAIN &&
      process.env.EXPO_PUBLIC_USER_POOL_ID &&
      (process.env.EXPO_PUBLIC_WEB_CLIENT_ID || process.env.EXPO_PUBLIC_NATIVE_CLIENT_ID)
  );
}

export function createMutationId(): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  return randomUUID ? randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function cloudRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_URL) throw new CloudApiError({ code: 'internal', message: 'Cloud API is not configured.' }, 0);

  const session = await fetchAuthSession();
  const accessToken = session.tokens?.accessToken?.toString();
  if (!accessToken) throw new CloudApiError({ code: 'unauthorized', message: 'Please sign in again.' }, 401);

  let response: Response;
  try {
    response = await fetch(`${API_URL}/v1${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    throw new CloudApiError({ code: 'internal', message: 'Could not reach the cloud service. Your change was not saved.' }, 0);
  }

  const payload = (await response.json().catch(() => ({}))) as ApiResponse<T>;
  if (!response.ok || payload.error) {
    throw new CloudApiError(
      payload.error ?? { code: 'internal', message: `Cloud request failed (${response.status}).` },
      response.status
    );
  }
  if (payload.data === undefined) {
    throw new CloudApiError({ code: 'internal', message: 'Cloud service returned an invalid response.' }, response.status);
  }
  return payload.data;
}

export function cloudErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Cloud operation failed.';
}
