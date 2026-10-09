/**
 * A minimal HTTP routing layer over `node:http`.
 *
 * Express would add a dependency for path matching, body parsing and JSON
 * responses — about 120 lines of work, done here instead.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Database } from '../db/connection.ts';
import type { Actor } from '../domain/types.ts';
import { AppError, ErrorCode, validationError } from '../lib/errors.ts';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type RequestContext = {
  readonly db: Database;
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly body: unknown;
  /** Present only on routes declared with `auth: true`. */
  readonly actor: Actor;
};

export type Handler = (ctx: RequestContext) => Promise<unknown> | unknown;

import type { Capability } from '../domain/permissions.ts';

export type Route = {
  readonly method: HttpMethod;
  readonly path: string;
  readonly handler: Handler;
  /** Defaults to true; set false for login and health. */
  readonly auth?: boolean;
  /**
   * Checked before the request body is parsed.
   *
   * The service that does the work still enforces this and remains the
   * authority; declaring it here only fixes the ORDER. Without it a caller who
   * may not use the endpoint at all first has to satisfy its schema, and gets
   * told their payload is wrong when the honest answer is that the endpoint is
   * not theirs to call.
   */
  readonly capability?: Capability;
  /** Status code for a successful response. Defaults to 200. */
  readonly status?: number;
};

type CompiledRoute = Route & { readonly segments: readonly string[] };

export const compile = (routes: readonly Route[]): CompiledRoute[] =>
  routes.map((route) => ({ ...route, segments: route.path.split('/').filter(Boolean) }));

export type RouteMatch = { route: CompiledRoute; params: Record<string, string> };

export function matchRoute(
  routes: readonly CompiledRoute[],
  method: string,
  pathname: string,
): RouteMatch | { methodMismatch: true } | null {
  const parts = pathname.split('/').filter(Boolean);
  let pathMatched = false;

  for (const route of routes) {
    if (route.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < route.segments.length; i += 1) {
      const segment = route.segments[i] as string;
      const value = parts[i] as string;
      if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(value);
      else if (segment !== value) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    pathMatched = true;
    if (route.method === method) return { route, params };
  }
  return pathMatched ? { methodMismatch: true } : null;
}

const MAX_BODY_BYTES = 1_000_000;

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'DELETE') return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw validationError('Request body is too large');
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw === '') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw validationError('Request body is not valid JSON');
  }
}

/**
 * Headers every response carries.
 *
 * The app renders through `textContent` and loads nothing from a CDN, so a
 * strict CSP costs nothing and means one careless `innerHTML` later cannot be
 * turned into stolen session tokens.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload ?? null);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...SECURITY_HEADERS,
  });
  res.end(body);
}

export function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof AppError) {
    sendJson(res, error.status, error.toJSON());
    return;
  }
  // The detail stays in the server log. What goes back says nothing about the
  // schema or the stack — an error message is not a place to publish either.
  console.error('[error]', error);
  sendJson(res, 500, {
    error: {
      code: ErrorCode.INTERNAL,
      message: 'Something went wrong. The server log has the detail.',
      details: [],
    },
  });
}

/**
 * The caller's address, for the audit trail and the login throttle.
 *
 * `x-forwarded-for` is trusted because the intended deployment puts a TLS
 * proxy in front on the same host. Exposed directly to a network, that header
 * is caller-controlled and the throttle's per-address half can be sidestepped
 * — the per-email half cannot, which is why there are two.
 */
export function clientIp(req: IncomingMessage): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (first) return first.split(',')[0]?.trim() ?? null;
  return req.socket.remoteAddress ?? null;
}

export function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value.trim();
}

/** Comma-separated query parameter, e.g. `?status=blocked,review`. */
export function queryList(query: URLSearchParams, key: string): string[] {
  const raw = query.getAll(key).flatMap((value) => value.split(','));
  return raw.map((v) => v.trim()).filter(Boolean);
}
