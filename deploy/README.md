# Moving Team Ops to the office machine

The tool is one server and one database. Everybody else uses a browser — there
is nothing to install on their machines, and nothing to copy around. Five
copies of the app would mean five separate databases that never see each
other's work, so there is exactly one host.

This is the move from a laptop to a machine that is always on.

---

## 1. On the office machine

Node 22.6 or newer (`node --version`). Nothing else — the app has no runtime
dependencies.

```bash
sudo useradd --system --home /opt/team-ops-system --shell /usr/sbin/nologin teamops
sudo mkdir -p /opt/team-ops-system
sudo chown teamops:teamops /opt/team-ops-system
```

A dedicated user keeps the database out of reach of anyone else's login on that
machine.

## 2. Copy the app and the data across

From the laptop, with the server **stopped** on both sides:

```bash
npm run backup                       # a snapshot to carry with you
rsync -av --exclude node_modules --exclude logs \
  ~/team-ops-system/ office:/tmp/team-ops-system/
```

On the office machine:

```bash
sudo rsync -av /tmp/team-ops-system/ /opt/team-ops-system/
sudo chown -R teamops:teamops /opt/team-ops-system
```

What has to come with it, and why:

| | |
|---|---|
| `data/team-ops.db` | the only copy of everything — tasks, history, reviews |
| `.env` | the join code, the throttle settings, the TLS paths |
| `certs/ca.pem`, `certs/ca-key.pem` | the authority browsers already trust — bring it and nobody re-imports |
| `backups/` | optional, but there is no reason to leave old snapshots behind |

## 3. A stable address

This is what stops the certificate warnings for good. Either ask IT for a
**DHCP reservation** against the machine's MAC, or set a static address. Then
the IP never changes, and neither does the certificate.

Re-issue the certificate on the new host, reusing the authority you brought:

```bash
sudo -u teamops npm run tls:selfsigned
sudo -u teamops npm run tls:selfsigned teamops.office   # plus any DNS name
```

Because `certs/ca.pem` came with you, the machines that already imported it
need no further action.

## 4. Start it, and keep it started

```bash
sudo cp deploy/teamops.service /etc/systemd/system/
sudo nano /etc/systemd/system/teamops.service     # check User and the node path
sudo systemctl daemon-reload
sudo systemctl enable --now teamops
systemctl status teamops
```

It now survives reboots and restarts itself if it crashes — the two outages a
laptop guarantees.

## 5. Backups, somewhere other than this machine

```bash
sudo cp deploy/teamops-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now teamops-backup.timer
systemctl list-timers teamops-backup
```

**Edit `ExecStart` to add `--dir=` pointing off this box** — a NAS mount, a
second drive, anything that survives the machine dying. Snapshots on the same
disk as the database protect you from a mistake, not from hardware.

Restoring: stop the service, copy a snapshot over `data/team-ops.db`, start it.

```bash
sudo systemctl stop teamops
sudo -u teamops cp backups/team-ops-<stamp>.db data/team-ops.db
sudo systemctl start teamops
```

## 6. Tell the team

Each person needs three things:

1. **The URL** — `https://<hostname>.local:4000/` or the reserved IP
2. **Their account** — you add them on the Team screen and tell them the
   passcode you set. They cannot create their own.
3. **`certs/ca.pem`** imported once, so the browser stops warning:
   *Chrome → Settings → Privacy and security → Security → Manage certificates
   → Authorities → Import → tick "identifying websites"*, then fully restart
   the browser. On Linux this also works:
   `certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "Team Ops local CA" -i ca.pem`

Send `ca.pem` — never `ca-key.pem`. That key can mint certificates every
machine in the team trusts, and it belongs only on the server.

## 7. Then take the laptop out of the loop

Stop the old server, remove its backup cron entry (`crontab -e`), and keep the
final snapshot somewhere safe until the office machine has run for a few days.

---

## Later: access from outside the office

Everything above is LAN-only. When somebody needs it from home, the smallest
answer is [Tailscale](https://tailscale.com): install it on the server and on
each laptop, and the tool is reachable at a stable name from anywhere, with
nothing exposed to the public internet. `tailscale cert` also issues a real,
publicly trusted certificate — which retires `ca.pem` and the import step
entirely.

Do not port-forward 4000 to the internet. There is no idle timeout, sessions
live in `localStorage`, and the login screen lists who works here.
