/**
 * Walidacja żądań.
 *
 * Cienka nakładka na `@hono/zod-validator`, która zamienia błąd walidacji
 * w `ApiError` — żeby odpowiedź 400 miała ten sam kształt co każda inna
 * odpowiedź błędu, a nie własny, wymyślony przez bibliotekę.
 */

import { zValidator } from '@hono/zod-validator';
import type { z } from 'zod';
import { badRequest } from '../errors.js';

type Target = 'json' | 'query' | 'param';

function validate<T extends z.ZodType>(target: Target, schema: T) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      throw badRequest(
        'Żądanie nie przeszło walidacji',
        result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      );
    }
    return undefined;
  });
}

export const validateJson = <T extends z.ZodType>(schema: T) => validate('json', schema);
export const validateQuery = <T extends z.ZodType>(schema: T) => validate('query', schema);
export const validateParam = <T extends z.ZodType>(schema: T) => validate('param', schema);
