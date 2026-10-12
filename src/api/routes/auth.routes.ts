import type { Route } from '../http.ts';
import * as auth from '../../services/auth.service.ts';
import { object, str, optional, nullable } from '../../lib/validate.ts';
import { parseOrThrow } from '../../lib/validate.ts';
import { bearerToken, clientIp } from '../http.ts';
import { integrationStatus } from '../../integrations/registry.ts';
import { config } from '../../config/index.ts';
import { loadedDataset } from '../../db/seed.ts';
import { MIN_PASSCODE_LENGTH, MAX_PASSCODE_LENGTH } from '../../lib/passcode.ts';

const bootstrapSchema = object({
  name: str({ max: 120 }),
  email: str({ max: 200 }),
  /** Authorises the bootstrap; shared, and only useful on an empty system. */
  joinCode: str({ max: 200, trim: false }),
  /** Becomes this Task Assigner's own passcode. */
  passcode: str({ min: MIN_PASSCODE_LENGTH, max: MAX_PASSCODE_LENGTH, trim: false }),
  title: optional(nullable(str({ max: 120 }))),
});

const loginSchema = object({
  email: str({ max: 200 }),
  passcode: str({ max: 200, trim: false }),
});

export const authRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/health',
    auth: false,
    handler: ({ db }) => ({
      status: 'ok',
      layer: 1,
      dataset: loadedDataset(db),
      integrations: integrationStatus(),
      rules: config.rules,
    }),
  },
  {
    // Lets the login screen offer to create the first Task Assigner on a fresh system.
    method: 'GET',
    path: '/api/auth/state',
    auth: false,
    handler: ({ db }) => ({
      needsBootstrap: auth.needsBootstrap(db),
      userCount: auth.listSelectableUsers(db).length,
    }),
  },
  {
    method: 'POST',
    path: '/api/auth/bootstrap',
    auth: false,
    status: 201,
    handler: ({ db, body }) => {
      const input = parseOrThrow(bootstrapSchema, body);
      const { session, user } = auth.bootstrapFirstManager(db, input);
      return { token: session.token, expiresAt: session.expiresAt, user };
    },
  },
  {
    method: 'POST',
    path: '/api/auth/login',
    auth: false,
    handler: ({ db, req, body }) => {
      const input = parseOrThrow(loginSchema, body);
      const { session, user } = auth.login(db, input.email, input.passcode, {
        ip: clientIp(req),
      });
      return { token: session.token, expiresAt: session.expiresAt, user };
    },
  },
  {
    method: 'POST',
    path: '/api/auth/logout',
    auth: false,
    handler: ({ db, req }) => {
      const token = bearerToken(req);
      if (token) auth.logout(db, token, { ip: clientIp(req) });
      return { ok: true };
    },
  },
  {
    method: 'GET',
    path: '/api/auth/me',
    handler: ({ actor }) => actor,
  },
];
