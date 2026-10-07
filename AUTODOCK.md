# AutoDock — Layer 1 project data

How the AutoDock project was loaded into the Team Ops System, what was taken from
the source document, and — just as importantly — what was **not**.

**The project tracks the Stream 1 build plan: 28 tasks from `Build Timeline.pdf`.**

| Source | What it is | Rows | Loaded by default |
| --- | --- | --- | --- |
| **`Build Timeline.pdf`** | forward build plan, Stream 1 | 28 | **yes** |
| **`Daily task.pdf`** | daily task log, 10–23 Sep 2026 | 56 | no |

The daily task log is a record of past activity rather than work to be driven,
so it is no longer loaded. Its importer is kept intact and is one flag away:

```bash
npm run seed:reset                                  # Stream 1 only (default)
node src/db/seed.ts --dataset=AUTO_DOCK_WITH_LOG --reset   # plus the log
```

Everything below about the daily task log describes that second dataset.

---

## A1. The build timeline

```
AutoDock
├── MDS  Mechanical Design              (phase)
│     ├── Final Design Validation                   W1 - W2   3 tasks
│     ├── Electrical and Electronics Architecture   W1 - W2   5 tasks
│     └── Mechanical and Electrical Procurement     W3 - W4   2 tasks
├── WTS  Warehouse Testing Space        (phase)
│     └── Warehouse Rental Space                    W1 - W4   4 tasks
└── AMP  Autonomous Mobile Platform     (phase, "Warehouse Dependency")
      ├── Chassis Fabrication and Assembly          W4 - W6   3 tasks
      ├── Electrical Routing and Assembly           W5 - W8   2 tasks
      ├── Electronics Component Placement/Assembly  W5 - W10  5 tasks
      └── Mobility Testing                          W8 - W12  4 tasks
```

**This document finally populates the Deliverable level.** Its "Outcomes and
Deliverables" column became 13 deliverables, each dated only where the plan
dates it (`by W1`, `by W2`, `by W8`…). Five are marked critical, matching the
source's red highlighting: VFD order release, pneumatic system order release,
and intern/engineer hiring among them.

### Weeks are relative, so the anchor is configurable

The plan is written in weeks (W1…W14), not dates. `AUTODOCK_W1_START` in `.env`
is the single value that anchors the whole schedule; every date is derived from
it at import, and the relative label (`W4 - W6`) is kept on every record so the
plan survives re-anchoring.

```
AUTODOCK_W1_START=2026-10-05      # W1 begins this Monday
```

A week runs Monday–Sunday; work starts on its Monday and is due on its **Friday**,
because a deadline falling on a Sunday is not one anyone works to. With the
current anchor: soft deadline **W12 = 2026-12-25**, hard deadline
**W14 = 2027-01-08** ("assuming delays with buffers"). Buffer weeks W3 and W5 are
recorded as schedule metadata, not as work.

Change the anchor and re-run `npm run seed:reset` to move the entire plan.

### Long-lead items are not task dependencies

The "Long lead items/Dependencies" column holds **external constraints and
risks** — `VFD procurement - 8 week`, `Vendor delays`, `Subbu's availability /
Ashutosh leave`. These are stored against the **milestone**, not pushed into the
task dependency graph, which would assert task-to-task links the source never
draws. The dependency table remains empty, as it was after the first import.

---

## A. Data model

```
AutoDock  (project, code AD)
  └── Workstream              required parent of every task
        └── Milestone         OPTIONAL — only where the source supports one
              └── Deliverable OPTIONAL — only where the source names an artefact
                    └── Task
                          ├── Owner                single accountable person
                          ├── Supporting members
                          ├── Reviewer             (established once, DTL-056)
                          ├── Dependencies         (none — see §C)
                          └── Source provenance    row id, date, owner, status
```

**Milestone is optional, and that is the central change from Layer 1.** Layer 1
required every task to sit under a milestone, carry a deadline and carry a
priority. The real source establishes none of those for most rows, so the schema
was relaxed rather than the data being invented. A task's required parent is now
its **workstream**; milestone and deliverable attach when they are known.

### The ten workstreams

| Code | Workstream | Tasks | Milestones derived |
| --- | --- | --- | --- |
| `PRC` | Procurement & Vendors | 11 | Container Sourcing |
| `CNV` | Conveyor & Dock Integration | 8 | Conveyor Coupling Selection |
| `DOC` | Demo & Documentation | 8 | Demo Video Production |
| `ELE` | Electrical & Control Panel | 8 | Control Panel Layout |
| `SIM` | Simulation | 6 | Latch Simulation in SolidWorks; Robot Stack Simulation |
| `TST` | Testing & Validation | 4 | Latch Testing Documentation |
| `MEC` | Mechanical Design | 3 | — |
| `DEP` | Deployment / Site Readiness | 3 | — |
| `MAN` | Manipulation & Robotics | 3 | Robotic Arm Selection |
| `MKT` | Product / Market Research | 2 | — |

Task references run per project with the workstream in the middle:
`AD-CNV-027`, `AD-SIM-036`, `AD-DOC-048`.

### Milestones were derived, not assumed

Eight milestones exist. Each was created only where **two or more tasks in the
same workstream plainly drive one outcome**, and each carries its derivation on
the record (`Derived during import: …`), so the grouping can be audited or
rejected. For example, *Conveyor Coupling Selection* groups rows 4, 27, 28, 29,
30, 46 and 52 — one continuous thread from "how does the flexible conveyor join
the main conveyor" to "compile the options into one sheet".

**22 tasks have no milestone.** They sit directly under their workstream and are
flagged `MISSING_MILESTONE`. They are fully visible on the Milestones screen under a
"No milestone assigned" heading — nothing disappears for lacking structure.

### Three deliverables

Created only where the source names a concrete artefact *and* the task sits in a
milestone: the latch testing document, the connector/coupling comparison sheet,
and the Chinese-arm vs FANUC comparison table.

---

## B. Imported task summary

**28 tasks, all from the Stream 1 build plan.** No row was split, merged or
dropped. Counts for the `AUTO_DOCK_WITH_LOG` dataset, which adds the 56
daily-log rows, are given alongside.

### By source

| | Daily log (DTL-###) | Build timeline (BT-###) |
| --- | --- | --- |
| Tasks | 56 | 28 |
| With an owner | 56 | **0** — the plan names nobody |
| With a deadline | **0** — the log dates nothing | 28 |
| With a priority | 0 | 0 |
| Statuses | 24 done, 26 in progress, 6 not started | all not started |

### By owner (label as written in the source)

| Source owner | Tasks | Open | Completed |
| --- | --- | --- | --- |
| Mallikarjun | 17 | 8 | 9 |
| Firaz | 16 (+1 shared) | 11 | 6 |
| Rani | 10 | 2 | 8 |
| Ashutosh | 7 | 6 | 1 |
| Faizan | 5 | 5 | 0 |
| *Firaz / Ashutosh* | 1 | — | — |

The shared row (DTL-036) is counted under Firaz as owner with Ashutosh as a
supporting member — see §C.

### By status

| Mapped status | Tasks | From source values |
| --- | --- | --- |
| Completed | 24 | `Done` |
| In Progress | 26 | `In Progress`, `Running` |
| Not Started | 6 | `Planned`, plus 4 that could not be mapped |
| Blocked | 0 | the source records no blockers |
| Review | 0 | the source records no review state |

### Status mapping applied

| Source | Mapped to | Why |
| --- | --- | --- |
| `Done` | Completed | Unambiguous |
| `In Progress` | In Progress | Unambiguous |
| `Running` | In Progress | Reads unambiguously as work in flight |
| `Planned` | Not Started | Unambiguous |
| `EOD` | **not mapped** | A timing marker, not a status. Flagged. |
| `Transfer to Ashutosh` | **not mapped** | An ownership action, not a status. Flagged. |
| *(blank — 2 rows)* | **not mapped** | Nothing stated. Flagged. |

Unmapped rows take the neutral **Not Started** state because the column cannot be
null, the **raw text is preserved** on the task (`source_status`), and a
clarification is raised. `EOD` was explicitly *not* read as "done".

---

## C. Data quality report

**All 28 tasks carry two open clarifications: no owner and no priority —
56 items in total.** (With the daily log loaded: 65 of 84 tasks, 183 items.)
Run `npm run import:report` for the full list with task references.

| Code | Count | What it means |
| --- | --- | --- |
| `MISSING_PRIORITY` | 60 | Every open task, from both documents. |
| `MISSING_DUE_DATE` | 32 | Every open log task. The log has no deadlines. |
| `UNCLEAR_OWNER` | 29 | All 28 planned tasks, plus DTL-036's shared ownership. |
| `MISSING_MILESTONE` | 15 | Log tasks with no milestone established. |
| `POSSIBLE_DUPLICATE` | 15 | Within the log, and across the two documents. |
| `TRUNCATED_SOURCE_TEXT` | 13 | The task text is cut off in the supplied PDF. |
| `MAY_NEED_DECOMPOSITION` | 5 | One row covering several trackable activities. |
| `UNCLEAR_CLASSIFICATION` | 5 | Workstream inferred by the importer, not stated. |
| `AMBIGUOUS_STATUS` | 2 | `EOD` and `Transfer to Ashutosh`. |
| `MISSING_STATUS` | 2 | Blank status cells (DTL-008, DTL-021). |
| `UNCLEAR_OWNER` | 1 | DTL-036, "Firaz / Ashutosh". |
| `OWNERSHIP_TRANSFER` | 1 | DTL-048, "Transfer to Ashutosh". |
| `UNKNOWN_PROGRESS` | 1 | DTL-056, "70–80% Done". |

### What could not be determined from the source

**0. Two things the build timeline does not state.** It has **no owner column at
all**, so all 28 planned tasks are unassigned and flagged `UNCLEAR_OWNER` — a
plan that names nobody must not be parked on whoever imported it. It states no
priorities either. `owner_id` is now nullable for exactly this reason:
"unassigned" is a real state, shown as *Unassigned* and never as a name.

**1. The daily log states no deadlines.** Its Date column is the day each row was logged, not a
commitment. It is stored as `source_date` and labelled as such throughout the UI;
`due_date` is `NULL` on all 56 tasks. Consequence for those 56: **nothing is overdue and nothing is due soon**. The
rules switch on per task the moment a manager sets a real deadline.

The 28 planned tasks **do** carry deadlines, so the deadline engine is live for
them. With W1 anchored to 2026-10-05 the earliest is Fri 2026-10-16 (end of W2),
which is why the dashboard still reports `overdue = 0` and `due soon = 0` today —
correctly, not vacuously. The
`NO RECENT UPDATE` rule does work without a deadline, and flags all 32 open
tasks — correctly, since this is September work.

**2. No priorities exist.** All imported tasks are `priority = NULL`, rendered as
a dashed `P?` rather than a guessed P2. Unassigned priority contributes nothing
to the attention score, so unprioritised work cannot outrank work someone has
actually triaged.

**3. No dependencies exist.** Zero were created. Sheet ordering is not a
dependency, and the source never states one. Three pairs are *plausible* and are
left for the manager to confirm rather than asserted: DTL-029 → DTL-028
(collect parameters before compiling the sheet), DTL-031 → DTL-054 (latch
parameters before the simulation), DTL-043 → physical arm preparation.

**4. One reviewer, not five.** Only DTL-056 states review information
("Reviewed by Rani"), so it is the only task with a reviewer.

**5. Progress is mostly unknown.** `progress` is `NULL` for all in-progress
tasks rather than 0, because reporting 0% for work in flight would misrepresent
it. DTL-056's "70–80% Done" is preserved **as that text**, not converted to 75.

**6. Ownership of DTL-036.** The source says "Firaz / Ashutosh". Firaz is taken
as the accountable owner — he owns the entire latch/SolidWorks thread (DTL-001,
002, 003, 031, 053, 054) and is listed first — with Ashutosh as a supporting
member. **This is an inference and is flagged `UNCLEAR_OWNER`.**

**7. Five rows do not fit the workstream vocabulary.** Flagged
`UNCLEAR_CLASSIFICATION` with the reasoning on each:
- `DTL-026` "Screening questions for Robotics Hardware Engineer" — hiring work.
  Parked in Product / Market Research; **a Team & Hiring workstream is likely
  needed.**
- `DTL-021` CE/FCC/EU certification — regulatory, not site readiness. Parked in
  Deployment; **a Compliance workstream may be needed.**
- `DTL-009` "Table comparative" — two words, no object.
- `DTL-008` "Need to validate as a design from functionality POV" — no subject.
- `DTL-049` "Ongoing Project Tasks" — a placeholder, not a trackable task.

**8. Thirteen task descriptions are truncated** in the supplied PDF (the column
was too narrow). Text is stored exactly as supplied; the full wording needs
restoring from the original spreadsheet.

**9. The demo-video rows.** DTL-048 (Rani) and DTL-055 (Ashutosh) have identical
text, and DTL-048's status column reads "Transfer to Ashutosh". They were kept as
two records cross-referencing each other rather than merged, because merging
would destroy the transfer evidence.

---

## D. Files changed

**New**
```
src/seed/autodock-data.ts        the 56 daily-log rows + classification (data only)
src/seed/build-timeline-data.ts  the build plan: 3 phases, 8 milestones, 28 tasks,
                                 13 outcomes, 11 long-lead items (data only)
src/seed/build-timeline-loader.ts the plan importer and its rules
src/lib/weeks.ts                 relative week -> calendar date resolution
src/seed/source-record.ts        generic source-record contract + status mapping
src/seed/autodock-loader.ts      the importer and its rules
src/seed/demo-loader.ts          demo loading, moved out of db/seed.ts
src/seed/registry.ts             named datasets: DEMO | AUTO_DOCK
src/repositories/clarification.repo.ts
src/services/clarification.service.ts
src/db/report.ts                 `npm run import:report`
tests/autodock-import.test.ts    49 new tests
AUTODOCK.md                      this document
```

**Modified**
```
src/db/schema.sql           tasks: workstream_id added; milestone_id, priority,
                            progress, start_date, due_date now nullable;
                            source_date / source_status / source_owner_label /
                            source_ref / origin / progress_note / review_note added.
                            task_history: nullable actor + source column.
                            New table: task_clarifications.
src/db/migrate.ts           schema v2 + a guard that refuses to half-apply over v1
src/db/seed.ts              now a dataset dispatcher
src/domain/enums.ts         Origin, ClarificationCode, HistoryKind.Imported
src/domain/types.ts         nullable deadline/priority/progress, provenance fields
src/domain/exceptions.ts    deadline rules no-op without a deadline
src/domain/permissions.ts   ResolveClarification capability
src/repositories/task.repo.ts        nullable columns, new filters, loud failure
                                     on unmapped column writes
src/repositories/hierarchy.repo.ts   findWorkstreamAncestry
src/repositories/activity.repo.ts    system-attributed history
src/services/task.service.ts         workstream-parented creation; auto-resolves
                                     clarifications when a gap is filled
src/services/dashboard.service.ts    By Workstream, noDueDate/noPriority counts
src/services/project.service.ts      milestone-less tasks stay visible
src/api/routes/*.ts                  optional priority/dates, clarification routes
public/js/**                         honest rendering of unknown values
tests/*.test.ts                      updated for the new shape
package.json, .env.example           dataset scripts and SEED_DATASET
```

---

## E. Tests

```
Layer 1                 176  ✅ all still passing, none removed
AutoDock import (both
sources)                 60  ✅
Frontend render          49  ✅
────────────────────────────
Total                   285  ✅  0 failing
Type check              clean
```

The new tests are deliberately mostly **negative** — they assert the importer did
*not* invent things: no task has a due date; no task has a priority; zero
dependencies exist; `EOD` is not Completed; "70–80% Done" did not become 75; no
imported history entry is attributed to a real person; no imported history claims
to have happened today.

One real bug was caught during this work: setting a task's first deadline silently
failed to record `original_due_date`, because the column-patch helper skipped
unmapped fields without complaining. It now throws instead.

---

## F. How to reset and re-import

```bash
# 1. Reset the development database completely
rm -f data/team-ops.db*

# 2a. Load the real AutoDock project data (the default)
npm run setup
#    equivalently: npm run seed:reset

# 2b. …or load the demo dataset instead
npm run seed:demo

# 3. Inspect what the import could not determine
npm run import:report

# 4. Run it
npm start      # http://127.0.0.1:4000
```

`npm run seed` is a no-op on a database that already holds data; `seed:reset` and
`seed:demo` wipe first. A database records which dataset it holds, the API reports
it on `/api/health`, and the UI shows a banner naming it — so demo content and real
project data can never be mistaken for one another, and the loaders never mix.

**Signing in:** pick a user, passcode `demo1234` (`AUTH_PASSCODE` in `.env`).
Rani is the manager; Firaz, Ashutosh, Mallikarjun and Faizan are employees.

---

## G. What a manager should do first

The import leaves the project honest but deliberately incomplete. In order:

1. **Assign owners to the 28 planned tasks** — the build timeline names nobody,
   so no one is accountable for any of the forward plan yet. Highest-value action.
2. **Set deadlines on the 32 open log tasks** — the plan is scheduled, the
   historical log is not.
3. **Assign priorities** — 60 open tasks across both sources have none.
4. **Resolve the 15 cross-source overlaps** where the log and the plan describe
   the same work (battery sizing, cabin design, the components sheet, power
   distribution, warehouse selection).
5. **Decide the two "Mechanical Design" workstreams** — `MDS` is the plan's own
   phase; `MEC` was inferred from the log and is marked as such. They probably merge.
6. **Resolve the 13 truncated descriptions** from the original spreadsheet.
7. **Decide the two vocabulary gaps** — a Team & Hiring workstream and a
   Compliance workstream.
8. **Confirm DTL-036's owner**, and close out the DTL-048/DTL-055 transfer.
9. **Rewrite DTL-049** ("Ongoing Project Tasks") as real deliverables.
10. **Confirm the W1 anchor** (`AUTODOCK_W1_START=2026-10-05`). Every date in the
    plan moves with it.

Everything above is marked in the UI on the **Tasks** screen: an affected row carries an
accent edge and a *Gaps* count, and the *Needs clarification* filter narrows to just those.
The manager dashboard's **Requires clarification** card drills in by reason.
