/**
 * Shared test fixtures: an isolated in-memory database with the demo dataset
 * loaded, plus a throwaway HTTP server for the end-to-end tests.
 */
import type { Server } from 'node:http';
import { createDatabase, type Database } from '../src/db/connection.ts';
import { loadDataset } from '../src/db/seed.ts';
import { DatasetName } from '../src/seed/registry.ts';
import { createApp } from '../src/server.ts';
import * as userRepo from '../src/repositories/user.repo.ts';
import * as taskRepo from '../src/repositories/task.repo.ts';
import type { Actor } from '../src/domain/types.ts';
import { seedPasscode } from '../src/seed/passcodes.ts';

/** Isolated in-memory database holding the DEMO dataset. */
export function freshDb(): Database {
  const db = createDatabase(':memory:');
  loadDataset(db, DatasetName.Demo);
  return db;
}

/**
 * The live project: the Stream 1 build plan only. This is what `npm run setup`
 * loads and what the UI is tested against.
 */
export function autoDockDb(): Database {
  const db = createDatabase(':memory:');
  loadDataset(db, DatasetName.AutoDock);
  return db;
}

/**
 * The Stream 1 plan with the historical daily task log loaded alongside it.
 * Not the default, but the importer still ships, so it still gets tested.
 */
export function autoDockWithLogDb(): Database {
  const db = createDatabase(':memory:');
  loadDataset(db, DatasetName.AutoDockWithLog);
  return db;
}

export function actorByEmail(db: Database, email: string): Actor {
  const user = userRepo.findUserByEmail(db, email);
  if (!user) throw new Error(`No seeded user with email ${email}`);
  return { id: user.id, name: user.name, role: user.role };
}

export const manager = (db: Database): Actor => actorByEmail(db, 'demo.manager@example.com');
export const employee1 = (db: Database): Actor => actorByEmail(db, 'demo.employee1@example.com');
export const employee2 = (db: Database): Actor => actorByEmail(db, 'demo.employee2@example.com');
export const employee3 = (db: Database): Actor => actorByEmail(db, 'demo.employee3@example.com');

export function taskByRef(db: Database, ref: string): ReturnType<typeof taskRepo.findTaskByRef> {
  const task = taskRepo.findTaskByRef(db, ref);
  if (!task) throw new Error(`No seeded task with ref ${ref}`);
  return task;
}

export function firstTaskWhere(
  db: Database,
  predicate: (t: NonNullable<ReturnType<typeof taskRepo.findTaskByRef>>) => boolean,
): NonNullable<ReturnType<typeof taskRepo.findTaskByRef>> {
  const found = taskRepo.listTasks(db).find(predicate);
  if (!found) throw new Error('No seeded task matched the predicate');
  return found;
}

export type TestServer = {
  url: string;
  close: () => Promise<void>;
  request: (
    method: string,
    path: string,
    opts?: { token?: string; body?: unknown },
  ) => Promise<{ status: number; body: any; headers: Record<string, string> }>;
};

export async function startTestServer(db: Database): Promise<TestServer> {
  const server: Server = createApp(db);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
    async request(method, path, opts = {}) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (opts.token) headers.authorization = `Bearer ${opts.token}`;
      const response = await fetch(`${url}${path}`, {
        method,
        headers,
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
      });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text === '' ? null : JSON.parse(text);
      } catch {
        parsed = text;
      }
      return {
        status: response.status,
        body: parsed,
        headers: Object.fromEntries(response.headers),
      };
    },
  };
}

export async function loginAs(server: TestServer, email: string): Promise<string> {
  const result = await server.request('POST', '/api/auth/login', {
    body: { email, passcode: seedPasscode(email) },
  });
  if (result.status !== 200) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(result.body)}`);
  }
  return result.body.token as string;
}
