/**
 * HTTP entrypoint. Wires a database into the request pipeline and serves both
 * the JSON API and the static UI from one port.
 */
import { createServer, type Server } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { networkInterfaces, hostname } from 'node:os';
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

/**
 * The same app over TLS, when a certificate is configured.
 *
 * Without this, every passcode and every session token crosses the network as
 * readable text — and on a shared network the token is the whole account,
 * replayable by anyone who saw it go past.
 */
/** Every name and address a certificate claims, for the startup check below. */
function certificateNames(certPath: string): string[] {
  try {
    const alt = new X509Certificate(readFileSync(certPath)).subjectAltName ?? '';
    return alt.split(',').map((entry) => entry.trim().replace(/^(DNS|IP Address|IP):/, ''));
  } catch {
    return [];
  }
}

function createServerForConfig(db: Database): { server: Server; secure: boolean } {
  const { certPath, keyPath } = config.tls;
  if (!certPath || !keyPath) {
    return { server: createApp(db), secure: false };
  }
  const credentials = { cert: readFileSync(certPath), key: readFileSync(keyPath) };
  const server = createSecureServer(credentials, (req, res) => {
    void handleRequest(db, req, res);
  }) as unknown as Server;
  return { server, secure: true };
}

export function startServer(port = config.port, host = config.host): Server {
  const { server, secure } = createServerForConfig(getDatabase());
  const scheme = secure ? 'https' : 'http';
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
    console.log(`  ▸ UI  ${scheme}://${host === '0.0.0.0' ? 'localhost' : host}:${actual}/`);
    for (const lan of lanAddresses) {
      console.log(`  ▸ On this network:  ${scheme}://${lan}:${actual}/`);
    }
    // A laptop that moves between networks gets a new address, and the
    // certificate names the old one. The browser then says COMMON_NAME_INVALID,
    // which reads like a security problem rather than "re-run one command".
    if (secure && config.tls.certPath) {
      const covered = certificateNames(config.tls.certPath);
      const uncovered = lanAddresses.filter((ip) => !covered.includes(ip));
      if (uncovered.length > 0) {
        console.log('');
        console.log(`  ⚠  The certificate does not cover ${uncovered.join(', ')}.`);
        console.log('     Browsers reaching this machine on that address will refuse it.');
        console.log('     Re-issue:  npm run tls:selfsigned     (then restart)');
        console.log(`     Or use the name, which survives a move:  https://${hostname()}.local:${actual}/`);
        console.log('');
      }
    }
    if (lanAddresses.length > 0 && !secure) {
      console.log('');
      console.log('  ⚠  NOT ENCRYPTED. Passcodes and session tokens cross this network as');
      console.log('     readable text, and a token is the whole account for 12 hours.');
      console.log('     Set TLS_CERT_PATH and TLS_KEY_PATH — see `npm run tls:selfsigned`.');
      console.log('');
    }
    console.log(`  ▸ API ${scheme}://${host}:${actual}/api/health`);
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
