/**
 * Błędy API.
 *
 * Jeden kształt odpowiedzi błędu dla całego API: `{ error: { code, message } }`.
 * `code` jest stabilnym napisem, po którym może rozpoznawać sytuacje bot
 * Discord albo aplikacja; `message` jest po polsku i przeznaczony dla ludzi.
 */

import { z } from 'zod';

export const ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'internal',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Record<ErrorCode, 400 | 401 | 403 | 404 | 409 | 429 | 500> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError('bad_request', message, details);
export const unauthorized = (message = 'Wymagane uwierzytelnienie') =>
  new ApiError('unauthorized', message);
export const forbidden = (message: string) => new ApiError('forbidden', message);
export const notFound = (message: string) => new ApiError('not_found', message);
export const conflict = (message: string, details?: unknown) =>
  new ApiError('conflict', message, details);
export const rateLimited = (message: string) => new ApiError('rate_limited', message);

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export function toErrorResponse(error: ApiError): ErrorResponse {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
}
