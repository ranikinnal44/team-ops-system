/**
 * HTTP entrypoint. Wires a database into the request pipeline and serves both
 * the JSON API and the static UI from one port.
 */
import { createServer, type Server } from 'node:http';
import { networkInterfaces } from 'node:os';
import { config } from './config/index.ts';
import { getDatabase, closeDatabase, type Database } from './db/connection.ts';
import { handleRequest } from './api/router.ts';
import { integrationStatus } from './integrations/registry.ts';

/** Build a server around an explicit database — used by the tests. */
export function createApp(db: Database): Server {
  return createServer((req, res) => {
    void handleRequest(db, req, res);
  });
}

export function startServer(port = config.port, host = config.host): Server {
  const server = createApp(getDatabase());
  server.listen(port, host, () => {
    const address = server.address();
    const actual = typeof address === 'object' && address ? address.port : port;
    // When bound to every interface, print the address other machines use —
    // "0.0.0.0" is not something anyone can type into a browser.
    const lanAddresses =
      host === '0.0.0.0' || host === '::'
        ? Object.values(networkInterfaces())
            .flat()
            .filter((nic) => nic && nic.family === 'IPv4' && !nic.internal)
            .map((nic) => nic?.address)
            .filter((a): a is string => typeof a === 'string')
        : [];
    console.log(`\n  Team Ops System — Layer 1`);
    console.log(`  ▸ UI  http://${host === '0.0.0.0' ? 'localhost' : host}:${actual}/`);
    for (const lan of lanAddresses) {
      console.log(`  ▸ On this network:  http://${lan}:${actual}/`);
    }
    if (lanAddresses.length > 0) {
      console.log(
        '  ▸ Reachable by anyone on this network who has the passcode — see README security note.',
      );
    }
    console.log(`  ▸ API http://${host}:${actual}/api/health`);
    console.log(`  ▸ DB  ${config.databasePath}`);
    console.log(`  ▸ Integrations: ${JSON.stringify(integrationStatus())}\n`);
  });
  return server;
}

if (import.meta.filename === process.argv[1]) {
  const server = startServer();
  const shutdown = (): void => {
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
