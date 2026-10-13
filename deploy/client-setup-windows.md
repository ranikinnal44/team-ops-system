# Team Ops — set up your Windows computer

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
  Save it in your **Downloads** folder.
- You must be on the office network (or the VPN, if you use one).
- You do **not** need administrator rights. The steps below install it for
  your own user only.
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
work yourself with your shell tools; I'm not technical. I'm on Windows. The
certificate file is ca.pem (or team-ops-ca.crt) and I saved it in my
Downloads folder.

Expected SHA-256 fingerprint of the certificate (given by my manager):
A7:57:0E:DF:7D:FB:06:7C:46:DD:39:02:CE:E2:68:B3:FC:B4:2B:A6:FA:CD:80:A6:FB:AC:35:EE:07:42:6C:DA

Do this in order, in PowerShell:

1. Find the file. Confirm it contains "BEGIN CERTIFICATE" and does NOT
   contain "PRIVATE KEY". If it contains a private key, STOP and tell me.
2. Compute the certificate's SHA-256 fingerprint, e.g.
   (New-Object System.Security.Cryptography.X509Certificates.X509Certificate2("$HOME\Downloads\ca.pem")).GetCertHashString('SHA256')
   and compare it with the expected one (ignore the colons and letter case).
   If it does not match exactly, STOP, install nothing, and tell me to
   contact my manager.
3. Install it for MY USER only, with no administrator rights:
   certutil -user -addstore Root "$HOME\Downloads\ca.pem"
   Tell me before you run it. Windows will show a security prompt; tell me
   to click Yes, because only I can approve it.
4. Check which of Chrome, Edge and Firefox I have. Chrome and Edge use the
   Windows store and need nothing more. For Firefox, tell me to set
   security.enterprise_roots.enabled to true in about:config (or import the
   file under Settings > Privacy & Security > View Certificates >
   Authorities).
5. Tell me to fully quit and reopen my browser. Then verify with:
   curl.exe https://vrobotics.local:4000/api/health
   It should print a response containing "status":"ok" with no certificate
   error. If vrobotics.local cannot be found, try
   https://192.168.29.31:4000/ and tell me.
6. Report what you installed and how to remove it again.

Rules: install only this one certificate. Do not list, export or touch any
other certificates, passwords, browser data or files. Do not read any file
with "key" in its name. Do not send anything off this computer. If anything
fails or looks unexpected, stop and explain instead of trying workarounds.
```

---

## Option B — do it yourself (about 3 minutes)

**1. Check the file is the right one.** Open **PowerShell** (Start menu →
type `PowerShell`) and run:

```powershell
(New-Object System.Security.Cryptography.X509Certificates.X509Certificate2("$HOME\Downloads\ca.pem")).GetCertHashString('SHA256')
```

It must print exactly this (ignore the colons and upper/lower case):

```
A7570EDF7DFB067C46DD3902CEE268B3FCB42BA6FACD80A6FBAC35EE07426CDA
```

**If it does not match, stop. Do not import it. Tell your manager.**

**2. Import it for your user:**

```powershell
certutil -user -addstore Root "$HOME\Downloads\ca.pem"
```

Windows asks "Do you want to install this certificate?". Click **Yes**.

**3. Fully quit and reopen your browser** (close every window, not just the
tab).

**4. Firefox only:** Firefox keeps its own list. Either:
- type `about:config` in the address bar, search for
  `security.enterprise_roots.enabled`, and set it to **true**; or
- go to **Settings → Privacy & Security → View Certificates → Authorities →
  Import**, pick `ca.pem`, and tick *"Trust this CA to identify websites"*.

Chrome and Edge need nothing extra.

---

## Check it worked

1. Open **https://vrobotics.local:4000/**
2. You should see the Team Ops sign-in page with a padlock and **no warning**.
3. Optional command-line check:
   ```powershell
   curl.exe https://vrobotics.local:4000/api/health
   ```
   It should print something containing `"status":"ok"`.

## If it doesn't work

| What you see | What to do |
|---|---|
| Browser still warns "not private" | Close **all** browser windows and reopen. For Firefox, do step 4 above. |
| "Site can't be reached" / "server not found" | Try **https://192.168.29.31:4000/**. If that works, the name isn't resolving on your network: tell your manager. |
| Page times out | You may be on guest Wi-Fi or another network. Join the office network, or the VPN. |
| `certutil` says access denied | Make sure you used `-user` exactly as written. Do not run PowerShell as administrator. |
| The fingerprint doesn't match | Stop. Delete the file and ask your manager to resend it. |

## Remove it again (only if you ever need to)

```powershell
certutil -user -delstore Root "Team Ops local CA (rani-OMEN)"
```

## Prompt for troubleshooting

If you get stuck, paste this into Claude together with what you see on screen:

```
I'm on Windows and I'm trying to open https://vrobotics.local:4000/ , an
internal tool whose certificate is signed by our own team authority. I
imported ca.pem with: certutil -user -addstore Root "$HOME\Downloads\ca.pem".
Here is what I see (error text or description): <PASTE HERE>
Browser: <Chrome / Edge / Firefox>. Please help me work out the cause one step
at a time. Only suggest changes for this one certificate. Never ask me to
import a file with "key" in its name, and never to disable security warnings
or use "proceed anyway".
```
