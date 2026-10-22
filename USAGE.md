# Using Team Ops

A guide for the three people who use this system: the **Task Assigner** who owns the plan,
the **member** who does the work, and the **reviewer** who signs it off.

Read your own section end to end. The first two sections apply to everybody.

---

## 1. What this system is for

Team Ops answers two questions that normally get answered in meetings:

- **For the team lead:** what is happening, what is late, what is blocked, who owns it,
  and what needs intervention today.
- **For the person doing the work:** what do I need to do today, and what is stopping me.

It is not a chat tool or a document store. It tracks **commitments** — who said they
would deliver what, by when — and makes it visible when one is at risk.

### The three rules everything else follows from

Almost every message the system shows you comes back to one of these.

**1. One accountable owner.**
Every task has exactly one owner. Supporting members can help and can report on a day's
work, but only the owner drives the task's status. Work with nobody's name on it shows up
as unassigned rather than being quietly parked on whoever typed it in.

**2. Deadlines are calculated, not typed.**
A Task Assigner sets an *effort budget* — how many working days a task is worth. The
**Member** says which day they start. The deadline follows from the two, counted over
working days only, so a weekend never eats into the time. Nobody types a due date, and
nobody can quietly take longer than they were given. Needing more days means asking, and
the approval leaves a record of who agreed it and why. Nothing can start before a start
date is set.

**3. Work is signed off by someone other than whoever did it.**
The owner applies for review; they cannot grant it. Only the task's named reviewer (or a
Task Assigner, so an absent reviewer never deadlocks a task) can move work to Completed or send
it back.

---

## 2. Getting in — everybody

1. Open the app in a browser (ask whoever runs it for the address; by default it is
   `http://<server>:4000`).
2. Pick your name from the list on the sign-in screen.
3. Enter your passcode and press **Sign in**.

Your passcode is your own. The Task Assigner who added you to the team chose it and will have
told you what it is; if you have lost it, ask any Task Assigner to reset it. Nobody — including
the Task Assigner doing the reset — can read your existing passcode back, only replace it.

On a brand-new system with nobody in it yet, the sign-in screen instead offers to create
the first Task Assigner. That needs the **join code** (`AUTH_JOIN_CODE`, from whoever set the
server up), which authorises that one account and nothing else. That first Task Assigner then
builds the plan and adds everyone else.

### What you see after signing in

| | Task Assigner | Reviewer | Member |
| --- | --- | --- | --- |
| Lands on | Dashboard | Dashboard | My work |
| **Dashboard** — the whole team's exceptions | yes | yes | — |
| **My work** — your own queue | yes | yes | yes |
| **Tasks** — searchable list, with review lenses | everything | everything | your tasks only |
| **Plan** — build the project structure | yes | yes | — |
| **Milestones** — the plan as a timeline | yes | yes | yes |
| **Team** — the roster | edit | edit | read |
| **Activity** — what changed recently | yes | yes | yes |

A reviewer has the same access as a Task Assigner: the two roles differ in what each is
expected to do, not in what the system allows.

### Reading a task

Every task has a reference like `AD-MEC-001` (project, workstream, number). Use it when
you talk about a task; it is a link everywhere it appears.

Coloured tags on a task tell you why it needs attention:

| Tag | Means |
| --- | --- |
| **Overdue** | The agreed end date has passed and the task is not complete. |
| **Due within 2 days** | The deadline is close. |
| **Blocked** | Something outside the task is stopping it. The blocker is named on the task. |
| **No recent update** | Nobody has touched the task in more than 2 working days. |
| **No daily outcome logged** | The task is in progress but yesterday produced no reported outcome. |
| **Needs a start date from its owner** | Assigned and budgeted, but the owner has not said when they start. |
| **N GAPS** | Imported data the source document did not establish. Nothing was guessed — see below. |

### Gaps

Some tasks came from an imported plan rather than being typed in here. Where the source
document did not say something — who owns it, what the deadline is, which milestone it
belongs to — the system records a **gap** instead of inventing a value. Gaps appear as a
`GAPS` tag on the task and as "Requires clarification" on the Task Assigner dashboard.

Open the task, click the `GAPS` tag, and the missing field is highlighted with a control to
fill it in. Filling it closes the gap automatically — there is no separate "mark as done".

---

## 3. The life of a task

This is the spine. Every role's section below is a view of the same sequence.

| # | Step | Who does it | Where |
| --- | --- | --- | --- |
| 1 | Create the project, workstreams and milestones | Task Assigner | Plan |
| 2 | Create the task, naming a **reviewer** and an **effort budget** | Task Assigner or Reviewer | Tasks → + New task |
| 3 | Give the task an owner and a priority | Task Assigner or Reviewer | Tasks (bulk) or the task itself |
| 4 | Pick a start date; the deadline is calculated | Member | Task → Set the schedule |
| 5 | Start work: **Not Started → In Progress** | Member | Task → Update this task |
| 7 | Log what each working day produced | Owner or supporting member | Task → Daily outcomes |
| 8 | Flag a blocker if work stops | Owner | Task → Update this task |
| 9 | Apply for review: **In Progress → Review** | Owner | Task → Update this task |
| 10 | Sign off (**→ Completed**) or send back (**→ In Progress**) | Reviewer | Task → Update this task |

And the exception, which can happen any time after step 5:

| | Ask for more time | Owner | Task → Deadline |
| --- | --- | --- | --- |
| | Approve or reject the extension | Task Assigner, or the task's reviewer | Dashboard, or the task |

### The five statuses

| Status | Meaning | Can move to | Who may move it |
| --- | --- | --- | --- |
| **Not Started** | Nothing has begun. | In Progress | Owner, reviewer or Task Assigner — **only once dates are agreed** |
| **In Progress** | Live work. Owes a daily outcome. | Blocked, Review | Owner, reviewer or Task Assigner |
| **Blocked** | Stopped by something external. **Must name the blocker.** | In Progress | Owner, reviewer or Task Assigner |
| **Review** | Finished, waiting for sign-off. | Completed, In Progress | **The named reviewer, or a Task Assigner** |
| **Completed** | Signed off. | In Progress (reopen) | **Task Assigner only** |

Progress percentage follows the status: moving to Completed sets 100%, moving to Not
Started sets 0%, and you cannot type 100% until the task is at Review or Completed.

---

## 4. If you are a member

Your job in this system is to keep your own commitments visible: agree dates you can hit,
say what each day produced, and raise a blocker early rather than silently slipping.

### Your day starts on **My work**

The tiles across the top are your own counts — due today, overdue, blocked, awaiting
review, needs an update. Below them:

- **Focus — what to do next.** Your open tasks, most urgent first. Start here.
- Then a grid: Overdue, Due today, Due tomorrow, Due this week, Blocked, Awaiting review,
  No recent update, **Owes a daily outcome**, Recently completed.

If a task is in the "Owes a daily outcome" box, someone will chase you for it. Clear it
first.

### Step 1 — Say when you start

When a Task Assigner assigns you a task, it arrives with an **effort budget** (for example
"3 working days") but no start date. The task shows **Needs a start date from its owner**.

Open the task and use the **Set the schedule** panel:

- pick a **start date** — it has to be a working day,
- adjust **working days** if you need fewer than you were budgeted, and
Nothing has to be planned day by day — you report what each day produced as you go.

The **deadline appears as you type**, counted over working days: three days from a Thursday
finishes on the Monday, not the Saturday. Submit and the task is scheduled — nobody has to
agree it, and you can start.

> A task runs for at most **5 working days** by default. If the work genuinely needs
> longer, it is not a task — ask your Task Assigner to split it.

### Step 2 — Start the work

Open the task → **Update this task** → set **Status** to `→ In Progress` → **Save update**.

If the system refuses with *"This task has no agreed dates yet"* or *"These dates are still
with the reviewer"*, go back to step 1. Nothing starts on an unagreed schedule.

### Step 3 — Log a daily outcome, every working day

This is the habit the whole system is built around. On the task, under **Daily outcomes**:

- **Today** — what the day actually produced. Not what you worked on; what is now done.
- **Progress** — optional percentage. If you enter one, it becomes the task's progress.

Press **Record outcome**. You can log a day's outcome while the task is **In Progress** or
**Blocked**, and either the owner or a supporting member can file one. You cannot log for a
future date, and logging again for the same day replaces that day's entry.

### Step 4 — Raise a blocker the moment you have one

**Update this task** → Status `→ Blocked`, and fill in **Blocker** describing what is
stopping you. The blocker is required — a blocked task that does not say what is blocking it
helps nobody. It then shows on your Task Assigner's dashboard immediately.

Clear the blocker and move back to **In Progress** when it is resolved.

Two other fields on the same form are worth using:

- **Next action** — the single next step. It shows on the task as a callout.
- **Output / evidence link** — a URL to the drawing, document, PR or test result that
  proves the task is done. Fill this in before you send the task to review; your reviewer
  will ask for it otherwise.

### Step 5 — Send it for review

**Update this task** → Status `→ Review` → **Save update**.

You cannot complete your own work, and you cannot pull a task back out of Review. That is
deliberate — otherwise anyone could withdraw from review and walk a task to Completed the
long way round. Your reviewer either signs it off or sends it back to In Progress with a
comment.

### Asking for more time

Once dates are agreed, they are locked. You cannot edit them — you request a change, and
someone approves it.

On the task, in the **Deadline** panel:

1. Set a **New end date**.
2. Give a **Reason** — why the agreed date is no longer reachable.
3. Press **Request more days**.

The request appears on the Task Assigner's dashboard and on the task. While it is pending the
task shows "Awaiting a Task Assigner decision", and you can only have one pending request per
task at a time. Approved, the end date moves and the budget rises to match; the system
still remembers your original date, so slippage stays measurable.

The request is refused if the new date would push the task past the 5-working-day cap.
Split the remaining work into a new task instead.

### What you cannot do, and who to ask

| You want to | Ask |
| --- | --- |
| Change the owner, title, description or priority | Your Task Assigner |
| Get more time | Request more working days (a Task Assigner or your reviewer approves; the deadline moves with the budget) |
| Change the effort budget, milestone, dependencies or supporting members | Your Task Assigner |
| Change the reviewer | Your Task Assigner |
| Mark your own work Completed | Your reviewer |
| See a colleague's tasks | Not available — you see the tasks you are on |

---

## 5. If you are a Task Assigner

You own the plan and the structure. You do not own the dates — the people doing the work
pick their own start date. Your job is to budget the effort, name the
accountable people, and act on the exceptions.

### Step 1 — Build the plan (**Plan** tab)

On an empty system, the Plan screen starts by asking for the project. Then build downwards:

**Project** → **Workstreams** → **Milestones** → **Deliverables**

- A **workstream** is a strand of the project — Mechanical Design, Procurement, Testing.
  Give it a short code (`MEC`); it becomes part of every task reference underneath it.
- A **milestone** is an outcome inside a workstream. It carries **no calendar dates** —
  only the plan's own wording, like "W1 - W2". Dates are agreed per task, by its owner and
  reviewer, once somebody is accountable for the work.
- A **deliverable** is a named output under a milestone. Optional, and it only gets a date
  once one has genuinely been agreed.

Deleting refuses while anything still hangs off a node, and tells you what.

### Step 2 — Add your team (**Team** tab)

**Add a team member**: name, email (this is how they sign in, and must be unique), role,
an optional designation, and a **passcode** of at least 6 characters. You choose their
passcode and tell them what it is — there is no email round trip here.

If somebody forgets theirs, use **Reset passcode** on their row and give them the new one.
You cannot read an existing passcode back; it is stored hashed, so it can only be replaced.

Choosing the role:

- **Member** — does the work. Sees only the tasks they are on.
- **Reviewer** — confirms what other people commit to: proposed dates, submitted work, and
  extension requests, on the tasks they are named on. Sees everything so they can find what
  is waiting on them. Can also own work of their own.
- **Task Assigner** — everything above plus the plan, the roster and the budgets.

Two things the system will not let you do:

- **Remove the last active Task Assigner.** Promote someone else first, or nobody could assign
  work or approve deadline changes.
- **Deactivate someone who still owns open work.** It names the tasks; reassign them first.
  Every task has one accountable owner, and deactivating someone silently breaks that.

### Step 3 — Create tasks (**Tasks → + New task**)

Two fields are mandatory and neither can be filled in later by somebody else:

- **Reviewer** — required at creation. Work is signed off by someone other than whoever did
  it, so a task with no reviewer could never reach Completed.
- **Effort budget** — required, in working days, maximum 5. This is the only scheduling
  number you set. Work that needs longer is a milestone, not a task; break it down.

Everything else can wait:

- **Owner** — leave it unassigned if it has not been decided. An unassigned task says so,
  rather than being parked on you.
- **Priority** — P0 Critical, P1 High, P2 Normal, P3 Low. Leave unassigned if undecided.
- **Start / end dates** — leave blank for the owner to propose. That is the normal path.
- **Supporting members** — people who help and can log daily outcomes, but do not drive the
  task.
- **Dependencies** — tasks that must land before this one.

### Step 4 — Assign in bulk (**Tasks**)

A freshly imported or newly built plan is a pile of unassigned tasks. On the Tasks screen,
filter to `No owner`, select the rows (there is a select-all per group), and set an owner
and/or a priority for the whole selection in one action.

The Tasks screen also filters by workstream, owner, status, priority, condition (Overdue,
Blocked, Due within 2 days, No recent update) and data state (Needs clarification, No due
date, No priority, No owner), and groups by workstream, milestone, owner or status.

### Step 5 — Work the dashboard, in this order

The **Dashboard** is your daily driver. It is ordered deliberately:

1. **Waiting on you** — decisions only you can make, on the tasks you are named reviewer
   of: dates to agree, work to sign off, extensions to decide. Appears only when there is
   something in it, and every row is somebody who cannot move until you act.
2. **Before this plan can be worked** — appears only while tasks still have no owner, no
   priority or no deadline. Until this is empty, exception lists are noise. Clear it next.
3. **Needs your intervention** — the open tasks carrying exceptions, worst first.
4. **The exception grid** — Overdue · Due within 2 days · Blocked · No recent update ·
   **Needs a start date** · **No daily outcome**. Empty buckets collapse to one line, so a
   quiet week does not look like a broken page.
   - *Needs a start date* is **somebody waiting**, not work running late. It is the
     cheapest thing on the page to fix.
5. **Requires clarification** — gaps from imported data. Each count links straight to the
   filtered task list.
6. **Deadline change requests** — the rest of the pending requests, minus the ones
   already in your own panel above.
7. **By workstream** and **Team progress** roll-ups. Click any person to open their board.

### Deciding a request for more days

Approve or reject from the dashboard card, or open the task. Approving:

- moves the end date,
- raises the effort budget to match the new window if needed, and
- **keeps the original date on record**, so slippage against the first commitment stays
  measurable however many extensions follow.

Any days the extension adds will need a daily outcome, so expect the owner to fill those in.

### Your escape valves

You are the fallback everywhere, so a single absent person never deadlocks a task:

- You can agree a proposed schedule if the reviewer is away.
- You can sign off or send back work in Review.
- You can **reopen a Completed task** back to In Progress. Nobody else can — reopening
  finished work is a correction, so it is reserved for you.
- You can set the schedule and agree it in the same action. Your own submission does not sit
  in a queue addressed to yourself.

What you cannot do: move locked dates by editing them. Even for a Task Assigner, an agreed
schedule moves only through the extension flow — otherwise the change leaves no trace of who
decided it.

---

## 6. If you are a reviewer

You confirm what other people commit to, and you hold every permission a Task Assigner has:
plan, assign, manage the team and decide extensions on any task. Your particular job is the
three decisions below, on the tasks you are named on.

You can see every task in the system, and you can edit tasks, assign them, and run the Plan and
Team screens exactly as a Task Assigner can.

### Finding what is waiting on you

Open the **Dashboard**. The first thing on it is **Waiting on you**, and it holds only
your decisions — not the project's. It has up to three groups:

- **Dates to agree** — proposals you have to approve or send back. Nothing starts until
  you do, so every row here is somebody who cannot move.
- **Work to sign off** — tasks submitted for your review.
- **Extensions to decide** — requests for more working days on tasks you review. Approve or
  reject them in place.

The heading carries the count, and the panel disappears entirely when there is nothing
waiting. Everything in it is yours: requests on tasks somebody else reviews never appear,
because they are not yours to decide.

Below it the board stays project-wide — the exception grid still shows **Dates awaiting
review** across every workstream, not just yours. That breadth is deliberate: a reviewer
sees the whole plan. The panel narrows it; it does not hide it.

From the **Tasks** screen you can get the same two queues as lists, with every other
filter still available. A **Waiting on me** row offers:

- **Work to sign off** — everything you review that is sitting at Review.
- **Dates to agree** — everything you review with a proposal outstanding.

Click an active lens again to clear it. There is also an **All reviewers** dropdown beside
**All owners**, so you can look at anyone else's queue — useful for covering a colleague.

### Decision 1 — More working days

A Member has asked for a bigger effort budget. Open the task; the **Effort budget** panel
shows what they have, what they are asking for, and why.

- **Approve** — the budget rises and the deadline moves with it. Any working day the change
  adds will need an outcome, which is raised as a clarification rather than invented.
- **Reject** — the budget stands. Leave a **Note** saying why; without one, they are
  guessing at what you wanted.

Ask yourself: does this fit around the person's other
commitments, and does each day's stated outcome actually add up to the task?

### Decision 2 — Sign the work off

When the owner sends a task to **Review**, open it and look at:

- the **Output / evidence link** — the artefact that proves it is done,
- the **Daily outcomes** log — what each day actually produced, and
- the **Activity history** — what changed and when.

Then **Update this task** → Status:

- `→ Completed` — signed off. Progress goes to 100% automatically.
- `→ In Progress` — sent back. Add a **Comment** in the same action saying what is missing;
  it lands in the activity log where the owner will see it.

Only you and a Task Assigner can make either move. The owner cannot complete their own work, and
cannot withdraw it from Review to get around you.

### Decision 3 — Decide an extension

When an owner asks for more time on a task you review, approve or reject it. Approving
moves the end date and raises the budget to match; the original date stays on record.

You can decide any pending request, like a Task Assigner. The dashboard shows all of them;
the ones on tasks you are named the reviewer of are the ones that are yours to answer.

### Reviewing your own work

You can own tasks like anyone else. On those, you are a member: propose your dates, log
your daily outcomes, request extensions. Someone else reviews them.

---

## 7. When the system says no

The refusals are the rules doing their job. The common ones:

| Message | What to do |
| --- | --- |
| *"This task has no start date yet. Set one before starting work."* | The Member picks a start date; the deadline is calculated from the budget. Then work can start. |
| *"These dates are still with the reviewer. Work starts once they are agreed."* | Chase the reviewer, or ask a Task Assigner to decide. |
| *"This task already has a start date."* | The schedule is set. To change how long it runs, ask for more days in the Effort budget panel. |
| *"Only this task's reviewer can move it from Review to Completed."* | Ask your reviewer, or a Task Assigner if they are away. |
| *"This task has no reviewer, so there is nobody to send it to."* | A Task Assigner assigns one, then it can go to review. |
| *"A blocked task must describe its blocker."* | Fill in the Blocker field. |
| *"Move the task to Review before marking it 100% complete."* | 100% means finished, and finished means reviewed. |
| *"A day of work cannot put the task at 100%."* | Same rule, from the daily outcome form. Log the day, then send the task for review. |
| *"The reviewer cannot be the owner."* | Nobody signs off their own work. Pick a different reviewer, or a different owner. In a bulk assignment the clashing tasks are skipped and listed; the rest still go through. |
| *"A daily outcome can only be logged while a task is in progress or blocked."* | Start the task first, or it is already past the point of daily logging. |
| *"Only the task owner or a supporting member can log a daily outcome."* | It is a report on work done, not a note about it. Comment instead. |
| *"Request a deadline change instead — a Task Assigner must approve it."* | You tried to edit the deadline directly. It is calculated, not typed. |
| *"Only a Task Assigner can reassign a task owner."* | Ask your Task Assigner. |
| *"These dates are not agreed yet, so there is nothing to extend."* | Propose the dates you need instead of requesting an extension. |
| *"This task already has a change awaiting a decision."* | Wait for it to be decided; one at a time. |
| *"That would make the task N working days; the cap is 5."* | Split the remaining work into a new task. |
| *"X still owns N open task(s)."* | Reassign them before deactivating the account. |

---

## 8. The rules, and where they are set

These thresholds are configuration, not code. Whoever runs the server can change them in
`.env`; everybody sees the same numbers.

| Rule | Default | Setting |
| --- | --- | --- |
| A task is flagged **Due soon** within | 2 calendar days | `DUE_SOON_DAYS` |
| A task is flagged **No recent update** after | 2 working days | `NO_UPDATE_WORKING_DAYS` |
| A task in progress is chased for a daily outcome after | 1 working day | `DAILY_UPDATE_WORKING_DAYS` |
| Largest effort budget a single task may carry | 5 working days | `MAX_TASK_EFFORT_DAYS` |
| How long a sign-in lasts | 12 hours | `SESSION_TTL_HOURS` |

---

## 9. Known gaps in the current build

Honest notes about where the app does not yet match the process described above. None of
them change the rules — they change where you have to go to apply them.

- **A Member cannot propose their own dates from the UI yet.** The Schedule panel
  currently renders for Task Assigners only; a member owner sees the Deadline panel instead.
  Until this is wired up, a Task Assigner sets the schedule (which agrees it in the same action),
  or the owner proposes dates through the API. Everything downstream — the lock, the
  the request-for-more-days flow, the "needs a start date" flag — works as written.
- **A reviewer decides deadline requests from the Dashboard, not from the task.** The
  task's own Deadline panel still shows Approve/Reject to Task Assigners only. Use the
  **Waiting on you** panel, which lists exactly the requests you can decide.
- **This is not production authentication.** There is no rate limiting, no lockout and no
  second factor. Run it on a network you trust.
