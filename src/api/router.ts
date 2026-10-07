/**
 * Request pipeline: route match -> authentication -> handler -> JSON response.
 * Static assets are served for anything that is not an `/api` path.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, extname, resolve } from 'node:path';
import type { Database } from '../db/connection.ts';
import { compile, matchRoute, readJsonBody, sendJson, sendError, bearerToken } from './http.ts';
import type { Route, RequestContext } from './http.ts';
import { authenticate } from '../services/auth.service.ts';
import { AppError, ErrorCode } from '../lib/errors.ts';
import { PROJECT_ROOT } from '../config/index.ts';
import { authRoutes } from './routes/auth.routes.ts';
import { projectRoutes } from './routes/project.routes.ts';
import { taskRoutes } from './routes/task.routes.ts';
import { supplyRoutes } from './routes/supply.routes.ts';
import { dashboardRoutes } from './routes/dashboard.routes.ts';
import { teamRoutes } from './routes/team.routes.ts';

export const routes: Route[] = [
  ...authRoutes,
  ...dashboardRoutes,
  ...teamRoutes,
  ...projectRoutes,
  ...supplyRoutes,
  ...taskRoutes,
];

const compiled = compile(routes);

const PUBLIC_DIR = resolve(PROJECT_ROOT, 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  // Normalise then confirm containment, so `../` cannot escape `public/`.
  const requested = pathname === '/' ? '/index.html' : pathname;
  const candidate = resolve(join(PUBLIC_DIR, normalize(requested)));
  const target = candidate.startsWith(PUBLIC_DIR + '/') || candidate === PUBLIC_DIR
    ? candidate
    : join(PUBLIC_DIR, 'index.html');

  let filePath = target;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    // Unknown path: fall back to the SPA shell so client routing works.
    filePath = join(PUBLIC_DIR, 'index.html');
  }

  try {
    await stat(filePath);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  res.writeHead(200, {
    'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  createReadStream(filePath).pipe(res);
}

export async function handleRequest(
  db: Database,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (!url.pathname.startsWith('/api/')) {
    await serveStatic(url.pathname, res);
    return;
  }

  try {
    const match = matchRoute(compiled, req.method ?? 'GET', url.pathname);
    if (match === null) {
      throw new AppError(ErrorCode.NOT_FOUND, `No route for ${req.method} ${url.pathname}`);
    }
    if ('methodMismatch' in match) {
      throw new AppError(ErrorCode.NOT_FOUND, `${req.method} is not supported on ${url.pathname}`);
    }

    const { route, params } = match;
    const body = await readJsonBody(req);
    const actor = route.auth === false
      ? { id: '', name: 'anonymous', role: 'employee' as const }
      : authenticate(db, bearerToken(req));

    const ctx: RequestContext = { db, req, res, params, query: url.searchParams, body, actor };
    const result = await route.handler(ctx);
    sendJson(res, route.status ?? 200, result ?? null);
  } catch (error) {
    sendError(res, error);
  }
}
