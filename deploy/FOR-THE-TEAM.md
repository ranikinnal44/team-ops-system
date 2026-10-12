# Getting into Team Ops

Send this page to everyone who will use the tool. It takes about three minutes,
once, per machine.

There is **nothing to install**. The tool runs on one machine in the office and
you use it through your browser, like any internal website.

---

## 1. Open it

**`https://OFFICE-MACHINE:4000/`**

> Replace `OFFICE-MACHINE` with the address you were given — something like
> `teamops.local` or `192.168.1.50`. Whoever set this up will tell you.

## 2. Expect one warning, once

The first time, your browser will say something alarming:

> **Your connection is not private** — attackers might be trying to steal your
> information… `NET::ERR_CERT_AUTHORITY_INVALID`

This is expected and it is not what it sounds like. The connection **is**
encrypted. Your browser is saying it does not recognise who issued the
certificate — because it was issued inside this company rather than bought from
a public authority.

Step 3 teaches your browser to recognise it, and the warning stops for good. If
you want to look around first, click **Advanced → Proceed**.

## 3. Install the certificate (one time)

You will be sent a small file called **`ca.pem`**. Save it somewhere you can
find it, then follow the section for your machine.

### Windows

1. **Double-click `ca.pem`.** If Windows does not offer to open it, rename it to
   `ca.crt` first.
2. Click **Install Certificate…**
3. Choose **Current User** → Next
4. Choose **Place all certificates in the following store** → **Browse** →
   **Trusted Root Certification Authorities** → OK → Next → Finish
5. Windows will ask if you are sure. Yes.
6. **Close Chrome or Edge completely** — every window — and open it again.

Chrome and Edge both use the Windows store, so this covers both.

### macOS

1. Double-click `ca.pem` — Keychain Access opens.
2. Add it to the **login** keychain.
3. Find it in the list (it is called *Team Ops local CA*), double-click it,
   expand **Trust**, and set **When using this certificate** to **Always Trust**.
4. Close the window, enter your password, and restart your browser.

### Linux — Chrome

```bash
sudo apt install libnss3-tools        # once, if you do not have it
certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "Team Ops local CA" -i ca.pem
```

Then quit Chrome completely and reopen it.

### Firefox (any operating system)

Firefox keeps its own list and ignores the system one, so do this as well if you
use Firefox:

**Settings → Privacy & Security → Certificates → View Certificates →
Authorities → Import** → choose `ca.pem` → tick **Trust this CA to identify
websites** → OK.

### Check it worked

Reload the page. You should see a normal padlock and no warning. If you still
see the warning, you probably did not fully close the browser — every window,
not just the tab.

## 4. Sign in

Type your **email address** and the **passcode** your Task Assigner gave you.
You cannot create your own account, and the page does not list who works here —
so use the address you were registered with.

After the first time, this browser remembers you and shows your name with just
a passcode box. If somebody else needs to sign in on the same machine, click
**Not you?**

Forgotten it? There is no reset email — ask your Task Assigner to set you a new
one. They cannot see your old passcode, only replace it.

Five wrong attempts and you are locked out for fifteen minutes. That is there to
stop someone guessing, not to catch you out — wait it out, or ask for a reset.

---

## What you can do, by role

| Role | What it means |
|---|---|
| **Task Assigner** | Plans the work: creates projects, workstreams, milestones and tasks, assigns owners, sets effort budgets, manages the team |
| **Reviewer** | Confirms what others commit to: approves the dates an owner proposes, signs off completed work, decides deadline extensions — for the tasks they are named on |
| **Member** | Does the work: proposes dates for their own tasks, reports progress daily, flags blockers, submits for review |

`USAGE.md` in the repo covers each role's day-to-day in detail.

---

## If something is wrong

**"This site can't be reached."** The office machine is off, asleep, or you are
not on the office network. The tool is only reachable from inside the office.

**The warning came back after it had gone.** The office machine's address
probably changed. Tell whoever set it up — they re-issue the certificate with
one command, and you do not have to re-import anything.

**You are signed out unexpectedly.** Sessions last 12 hours. They also end
immediately if your passcode or your role is changed, which is deliberate.

**Do not bookmark an IP address if you were given a name.** The name keeps
working when the machine's address changes; the address does not.
