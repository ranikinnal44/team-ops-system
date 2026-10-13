# Team Ops — set up your Linux computer

You do this **once**. Afterwards, `https://vrobotics.local:4000/` opens with a
padlock and no security warning.

**Why:** the tool uses a certificate issued by our own team authority. Your
browser doesn't know that authority yet, so it warns you. Importing the file
`ca.pem` tells your browser to trust it. The file is public and safe to
handle. It is not a password.

> If you already open the tool without a warning, you are done. Stop here.

---

## Before you start

- You need the file **`ca.pem`** (your manager shared it in Teams).
  Save it in your **Downloads** folder (`~/Downloads/ca.pem`).
- You must be on the office network (or the VPN, if you use one).
- These steps install it for your own user. The one exception is installing
  the `certutil` tool in step 2, which needs `sudo`, once.
- Never import, open or ask for a file called `ca-key.pem`. You will not need
  it, and nobody should send it to you.

---

## Option A — let Claude do it (easiest)

Use **Claude Code** (it can run commands on your computer; the normal chat
cannot). Open it in your Downloads folder, paste the prompt below, and
approve the steps it asks about.

```
I want you to install my company's internal certificate authority so my
browsers trust our internal tool at https://vrobotics.local:4000/ . Do the
work yourself with your shell tools; I'm not technical. I'm on Linux. The
certificate file is ca.pem (or team-ops-ca.crt) and I saved it in ~/Downloads.

Expected SHA-256 fingerprint of the certificate (given by my manager):
A7:57:0E:DF:7D:FB:06:7C:46:DD:39:02:CE:E2:68:B3:FC:B4:2B:A6:FA:CD:80:A6:FB:AC:35:EE:07:42:6C:DA

Do this in order:

1. Find the file. Confirm it contains "BEGIN CERTIFICATE" and does NOT
   contain "PRIVATE KEY". If it contains a private key, STOP and tell me.
2. Compute the fingerprint with:
   openssl x509 -in ~/Downloads/ca.pem -noout -fingerprint -sha256
   and compare it with the expected one. If it does not match exactly, STOP,
   install nothing, and tell me to contact my manager.
3. Work out which browsers I use (Chrome, Chromium, Edge, Firefox) and
   whether each is a normal install, a Snap or a Flatpak, because they keep
   certificates in different places.
4. Install for MY USER only. Never put it in the system-wide store.
   - Chrome, Chromium, Edge (normal installs): make sure `certutil` exists
     (package libnss3-tools; if it is missing, tell me the exact sudo
     command and let ME run it). Create ~/.pki/nssdb if it does not exist:
       mkdir -p ~/.pki/nssdb && certutil -d sql:$HOME/.pki/nssdb -N --empty-password
     Then:
       certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "Team Ops local CA" -i ~/Downloads/ca.pem
   - Firefox: import into each Firefox profile's certificate database, or
     tell me to use Settings > Privacy & Security > View Certificates >
     Authorities > Import and tick "Trust this CA to identify websites".
   - Snap or Flatpak browsers use their own location. Do not guess: tell me
     to import through the browser's own Settings instead.
   Tell me before each command what it does.
5. Check that vrobotics.local resolves: ping -c 1 vrobotics.local . If it
   does not, tell me to ask my manager; the usual fix is
   `sudo apt install avahi-daemon libnss-mdns`, which I will run myself.
6. Tell me to fully quit and reopen my browser. Then verify with:
   curl --cacert ~/Downloads/ca.pem https://vrobotics.local:4000/api/health
   It should print a response containing "status":"ok". If vrobotics.local
   cannot be found, try https://192.168.29.31:4000/ and tell me.
7. Report what you installed and how to remove it again.

Rules: install only this one certificate. Do not list, export or touch any
other certificates, passwords, browser data or files. Do not read any file
with "key" in its name. Do not send anything off this computer. Do not use
sudo yourself. If anything fails or looks unexpected, stop and explain
instead of trying workarounds.
```

---

## Option B — do it yourself (about 3 minutes)

**1. Check the file is the right one:**

```bash
openssl x509 -in ~/Downloads/ca.pem -noout -fingerprint -sha256
```

It must print exactly:

```
sha256 Fingerprint=A7:57:0E:DF:7D:FB:06:7C:46:DD:39:02:CE:E2:68:B3:FC:B4:2B:A6:FA:CD:80:A6:FB:AC:35:EE:07:42:6C:DA
```

**If it does not match, stop. Do not import it. Tell your manager.**

**2. Chrome, Chromium and Edge** (installed normally) keep certificates in a
per-user database. Install the helper tool if you don't have it:

```bash
sudo apt install libnss3-tools          # Debian / Ubuntu
# Fedora: sudo dnf install nss-tools
```

Create the database if it doesn't exist yet (harmless if it does):

```bash
mkdir -p ~/.pki/nssdb
[ -f ~/.pki/nssdb/cert9.db ] || certutil -d sql:$HOME/.pki/nssdb -N --empty-password
```

Import:

```bash
certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "Team Ops local CA" -i ~/Downloads/ca.pem
```

**3. Firefox** has its own list. Go to **Settings → Privacy & Security → View
Certificates → Authorities → Import**, pick `ca.pem`, and tick *"Trust this CA
to identify websites"*.

**4. Snap or Flatpak browsers** can't see `~/.pki`. Import through the
browser's own settings instead (Chrome/Chromium: Settings → Privacy and
security → Security → Manage certificates → Authorities → Import).

**5. Fully quit and reopen your browser** (every window).

**6. Make sure the name resolves.** `.local` names need `avahi`:

```bash
ping -c 1 vrobotics.local
```

If it says "unknown host":

```bash
sudo apt install avahi-daemon libnss-mdns
```

---

## Check it worked

1. Open **https://vrobotics.local:4000/**
2. You should see the Team Ops sign-in page with a padlock and **no warning**.
3. Optional command-line check:
   ```bash
   curl --cacert ~/Downloads/ca.pem https://vrobotics.local:4000/api/health
   ```
   It should print something containing `"status":"ok"`.

## If it doesn't work

| What you see | What to do |
|---|---|
| Browser still warns "not private" | Close **all** browser windows and reopen. Check which kind of install you have (normal, Snap, Flatpak, Firefox), and use that step. |
| "Server not found" | Run the `ping` check in step 6. Or try **https://192.168.29.31:4000/**. If the IP works, tell your manager. |
| Page times out | You may be on guest Wi-Fi or another network. Join the office network, or the VPN. |
| `certutil: command not found` | Do step 2's `sudo apt install libnss3-tools`. |
| The fingerprint doesn't match | Stop. Delete the file and ask your manager to resend it. |

## Remove it again (only if you ever need to)

```bash
certutil -d sql:$HOME/.pki/nssdb -D -n "Team Ops local CA"
```

For Firefox, remove it under View Certificates → Authorities.

## Prompt for troubleshooting

If you get stuck, paste this into Claude together with what you see on screen:

```
I'm on Linux (distro: <e.g. Ubuntu 24.04>) and I'm trying to open
https://vrobotics.local:4000/ , an internal tool whose certificate is signed
by our own team authority. I imported ca.pem into my browser's certificate
store. Here is what I see (error text or description): <PASTE HERE>
Browser: <Chrome / Chromium / Edge / Firefox>, installed as: <normal / Snap /
Flatpak>. Please help me work out the cause one step at a time. Only suggest
changes for this one certificate. Never ask me to import a file with "key" in
its name, and never to disable security warnings or use "proceed anyway".
```
