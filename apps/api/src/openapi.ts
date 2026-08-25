/**
 * Generowanie OpenAPI.
 *
 * Dokument powstaje z **tych samych** schematów Zod, którymi walidowane są
 * żądania — nie z osobnego opisu pisanego ręcznie. Osobny opis rozjeżdża się
 * z kodem po pierwszej zmianie pola i milczy o tym; tutaj zmiana schematu
 * natychmiast widać w dokumentacji, z której korzysta bot Discord.
 *
 * Zod 4 potrafi zamienić schemat na JSON Schema 2020-12, a OpenAPI 3.1 używa
 * dokładnie tego dialektu — więc konwersja jest jednym wywołaniem, bez
 * pośrednich bibliotek.
 */

import { z } from 'zod';
import { errorResponseSchema } from './errors.js';

export type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

/** `none` — bez uwierzytelnienia, `user` — sesja albo klucz API, `admin` — rola. */
export type SecurityLevel = 'none' | 'user' | 'admin';

export interface RouteResponse {
  status: number;
  description: string;
  schema?: z.ZodType;
}

export interface RouteSpec {
  method: HttpMethod;
  /** Ścieżka w notacji Hono (`/sets/:id`); do OpenAPI tłumaczona automatycznie. */
  path: string;
  summary: string;
  description?: string;
  tag: string;
  security: SecurityLevel;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  /**
   * Typ zawartości ciała. Domyślnie JSON, bo tak jedzie każde żądanie poza
   * jednym: nagranie przy dyktowaniu serii idzie `multipart/form-data`, żeby
   * plik nie rósł o trzydzieści procent narzutu base64.
   */
  bodyMediaType?: 'application/json' | 'multipart/form-data';
  responses: RouteResponse[];
}

const PATH_PARAMETER = /:([A-Za-z0-9_]+)/g;

export function toOpenApiPath(honoPath: string): string {
  return honoPath.replace(PATH_PARAMETER, '{$1}');
}

function toJsonSchema(schema: z.ZodType, io: 'input' | 'output'): Record<string, unknown> {
  return z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as Record<string, unknown>;
}

function parameterList(
  schema: z.ZodObject | undefined,
  location: 'path' | 'query',
): Record<string, unknown>[] {
  if (!schema) return [];

  const json = toJsonSchema(schema, 'input');
  const properties = (json.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((json.required ?? []) as string[]);

  return Object.entries(properties).map(([name, propertySchema]) => ({
    name,
    in: location,
    // Parametr ścieżki jest wymagany z definicji — OpenAPI nie dopuszcza innej opcji.
    required: location === 'path' ? true : required.has(name),
    schema: propertySchema,
  }));
}

const SECURITY_REQUIREMENT = [{ sessionCookie: [] }, { apiKey: [] }];

export interface OpenApiOptions {
  title: string;
  version: string;
  baseUrl: string;
}

export function buildOpenApiDocument(
  routes: readonly RouteSpec[],
  options: OpenApiOptions,
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    const path = toOpenApiPath(route.path);
    const operations = (paths[path] ??= {});

    const responses: Record<string, unknown> = {};
    for (const response of route.responses) {
      responses[String(response.status)] = {
        description: response.description,
        ...(response.schema
          ? { content: { 'application/json': { schema: toJsonSchema(response.schema, 'output') } } }
          : {}),
      };
    }

    // Każdy chroniony endpoint może odpowiedzieć 401; opisujemy to raz tutaj,
    // zamiast powtarzać przy każdej trasie.
    if (route.security !== 'none') {
      responses['401'] = {
        description: 'Brak lub nieprawidłowe uwierzytelnienie',
        content: { 'application/json': { schema: toJsonSchema(errorResponseSchema, 'output') } },
      };
    }
    if (route.security === 'admin') {
      responses['403'] = {
        description: 'Operacja zastrzeżona dla administratora',
        content: { 'application/json': { schema: toJsonSchema(errorResponseSchema, 'output') } },
      };
    }

    operations[route.method] = {
      summary: route.summary,
      ...(route.description ? { description: route.description } : {}),
      tags: [route.tag],
      ...(route.security === 'none' ? {} : { security: SECURITY_REQUIREMENT }),
      parameters: [...parameterList(route.params, 'path'), ...parameterList(route.query, 'query')],
      ...(route.body
        ? {
            requestBody: {
              required: true,
              content: {
                [route.bodyMediaType ?? 'application/json']: {
                  schema: toJsonSchema(route.body, 'input'),
                },
              },
            },
          }
        : {}),
      responses,
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: options.title,
      version: options.version,
      description:
        'API AlphaPump. Dostępne wyłącznie wewnątrz VPN. Uwierzytelnienie sesją ' +
        'better-auth albo nagłówkiem `x-api-key` — token API generuje użytkownik ' +
        'w swoim koncie i może mieć ich wiele.',
    },
    servers: [{ url: options.baseUrl }],
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization',
          description: 'Token sesji better-auth (`Bearer <token>`).',
        },
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'Token API użytkownika.',
        },
      },
    },
    paths,
  };
}
