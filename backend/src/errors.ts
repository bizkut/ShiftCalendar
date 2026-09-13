import type { ApiError } from '../../shared/cloudTypes.js';

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: ApiError['code'], message: string, readonly details?: unknown) {
    super(message);
  }
}

export const badRequest = (message: string) => new HttpError(400, 'bad_request', message);
export const forbidden = (message = 'Forbidden') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
export const conflict = (message = 'Version conflict') => new HttpError(409, 'conflict', message);
