/**
 * ===========================================================================
 *                                DEMO DATA
 * ===========================================================================
 *
 * Sample content so the system is testable the moment it starts. It is
 * DECLARATIVE CONFIG ONLY — nothing in `domain/`, `services/`, `repositories/`
 * or `api/` imports this file, and no demo name, email or task appears in any
 * business rule.
 *
 * Replacing it with real team data means editing this file (or writing a new
 * importer that produces the same shapes) and re-running `npm run seed:reset`.
 * No application code changes.
 *
 * Dates are expressed as OFFSETS IN DAYS from the day the seed is run, so the
 * demo keeps demonstrating overdue / due-today / due-soon / stale tasks
 * whenever it is loaded.
 * ===========================================================================
 */
import type { Role, TaskStatus, Priority } from '../domain/enums.ts';

export type DemoUser = {
  key: string;
  name: string;
  email: string;
  role: Role;
  title: string;
};

export type DemoMilestone = {
  key: string;
  name: string;
  targetInDays: number;
  deliverables?: { key: string; name: string }[];
};

export type DemoWorkstream = {
  key: string;
  code: string;
  name: string;
  milestones: DemoMilestone[];
};

export type DemoProject = {
  key: string;
  code: string;
  name: string;
  description: string;
  leadKey: string;
  workstreams: DemoWorkstream[];
};

export type DemoTask = {
  key: string;
  milestoneKey: string;
  deliverableKey?: string;
  title: string;
  description: string;
  ownerKey: string;
  reviewerKey?: string;
  supportKeys?: string[];
  priority: Priority;
  /**
   * Offsets in days from "today" at seed time. A task spans at most
   * `MAX_TASK_SPAN_DAYS` days inclusive, the same limit the app enforces on
   * anything created through it — the demo is not allowed to show work the
   * system would refuse.
   */
  startInDays: number;
  dueInDays: number;
  /**
   * What each day of the task delivers, in order from `startInDays`. Required
   * when the task spans more than one day; omitted for a single-day task.
   */
  dayOutcomes?: string[];
  /**
   * How long ago the task was raised. Defaults to the start offset. Set it
   * where the two differ — work raised a while back and since re-planned into
   * a short window near its deadline.
   */
  createdDaysAgo?: number;
  status: TaskStatus;
  progress?: number;
  blocker?: string;
  nextAction?: string;
  evidenceUrl?: string;
  dependsOnKeys?: string[];
  /** Backdates `last_updated_at`, which is what drives NO RECENT UPDATE. */
  lastUpdatedDaysAgo?: number;
  comments?: { authorKey: string; body: string; daysAgo: number }[];
};

export type DemoDeadlineRequest = {
  taskKey: string;
  requestedByKey: string;
  requestedDueInDays: number;
  reason: string;
  daysAgo: number;
};

export type DemoDataset = {
  label: string;
  users: DemoUser[];
  projects: DemoProject[];
  tasks: DemoTask[];
  deadlineRequests: DemoDeadlineRequest[];
};

export const DEMO_DATA: DemoDataset = {
  label: 'DEMO DATA — sample team, projects and tasks for evaluation only',

  users: [
    {
      key: 'mgr',
      name: 'Demo Manager',
      email: 'demo.manager@example.com',
      role: 'manager',
      title: 'Engineering Manager',
    },
    {
      key: 'emp1',
      name: 'Demo Employee 1',
      email: 'demo.employee1@example.com',
      role: 'employee',
      title: 'Robotics Engineer',
    },
    {
      key: 'emp2',
      name: 'Demo Employee 2',
      email: 'demo.employee2@example.com',
      role: 'employee',
      title: 'Perception Engineer',
    },
    {
      key: 'emp3',
      name: 'Demo Employee 3',
      email: 'demo.employee3@example.com',
      role: 'employee',
      title: 'Hardware Engineer',
    },
  ],

  projects: [
    {
      key: 'autodock',
      code: 'AD',
      name: 'AutoDock',
      description: 'DEMO — autonomous docking for the mobile robot fleet.',
      leadKey: 'mgr',
      workstreams: [
        {
          key: 'ad-hw',
          code: 'HW',
          name: 'Hardware',
          milestones: [
            {
              key: 'ad-hw-m1',
              name: 'Dock hardware revision B',
              targetInDays: 21,
              deliverables: [{ key: 'ad-hw-d1', name: 'Revision B assembly drawings' }],
            },
          ],
        },
        {
          key: 'ad-man',
          code: 'MAN',
          name: 'Manipulation',
          milestones: [
            {
              key: 'ad-man-m1',
              name: 'Gripper reliability at 99%',
              targetInDays: 30,
              deliverables: [{ key: 'ad-man-d1', name: 'Force-control tuning report' }],
            },
          ],
        },
        {
          key: 'ad-per',
          code: 'PER',
          name: 'Perception',
          milestones: [
            {
              key: 'ad-per-m1',
              name: 'Marker detection hardening',
              targetInDays: 14,
              deliverables: [{ key: 'ad-per-d1', name: 'Detection accuracy report' }],
            },
          ],
        },
        {
          key: 'ad-nav',
          code: 'NAV',
          name: 'Navigation',
          milestones: [{ key: 'ad-nav-m1', name: 'Approach accuracy within 5 mm', targetInDays: 18 }],
        },
        {
          key: 'ad-test',
          code: 'TEST',
          name: 'Testing',
          milestones: [{ key: 'ad-test-m1', name: 'Docking regression suite', targetInDays: 25 }],
        },
      ],
    },
    {
      key: 'warehouse',
      code: 'WA',
      name: 'Warehouse Automation',
      description: 'DEMO — pallet handling and inventory automation for the main warehouse.',
      leadKey: 'mgr',
      workstreams: [
        {
          key: 'wa-sw',
          code: 'SW',
          name: 'Software',
          milestones: [
            {
              key: 'wa-sw-m1',
              name: 'Inventory sync service v1',
              targetInDays: 20,
              deliverables: [{ key: 'wa-sw-d1', name: 'Sync service deployment' }],
            },
          ],
        },
        {
          key: 'wa-proc',
          code: 'PROC',
          name: 'Procurement',
          milestones: [{ key: 'wa-proc-m1', name: 'Long-lead items ordered', targetInDays: 10 }],
        },
        {
          key: 'wa-test',
          code: 'TEST',
          name: 'Testing',
          milestones: [{ key: 'wa-test-m1', name: 'Pick station acceptance', targetInDays: 28 }],
        },
      ],
    },
  ],

  tasks: [
    // --- completed ---------------------------------------------------------
    {
      key: 't-cal-extrinsics',
      milestoneKey: 'ad-per-m1',
      deliverableKey: 'ad-per-d1',
      title: 'Calibrate depth camera extrinsics',
      description:
        'Re-run the extrinsic calibration for the dock-facing depth camera and publish the updated transform.',
      ownerKey: 'emp1',
      reviewerKey: 'mgr',
      priority: 'P1',
      startInDays: -12,
      dueInDays: -10,
      dayOutcomes: [
        'Calibration rig set up and the reference targets placed.',
        'Extrinsic solve run and residuals checked against the 2 mm budget.',
        'Updated transform published and the report attached.',
      ],
      createdDaysAgo: 18,
      status: 'completed',
      progress: 100,
      evidenceUrl: 'https://example.com/demo/extrinsics-calibration-report',
      lastUpdatedDaysAgo: 10,
      comments: [
        { authorKey: 'emp1', body: 'Calibration converged; residual under 2 mm.', daysAgo: 11 },
        { authorKey: 'mgr', body: 'Reviewed and accepted. Nice turnaround.', daysAgo: 10 },
      ],
    },
    {
      key: 't-brackets',
      milestoneKey: 'ad-hw-m1',
      title: 'Source spare dock alignment brackets',
      description: 'Order ten spare alignment brackets to cover field replacements.',
      ownerKey: 'emp3',
      reviewerKey: 'mgr',
      priority: 'P2',
      startInDays: -8,
      dueInDays: -7,
      dayOutcomes: [
        'Bracket specification confirmed with the supplier and a quote received.',
        'Purchase order raised and acknowledged.',
      ],
      createdDaysAgo: 14,
      status: 'completed',
      progress: 100,
      evidenceUrl: 'https://example.com/demo/purchase-order-4471',
      lastUpdatedDaysAgo: 7,
    },

    // --- due today ---------------------------------------------------------
    {
      key: 't-gripper-force',
      milestoneKey: 'ad-man-m1',
      deliverableKey: 'ad-man-d1',
      title: 'Tune gripper force control loop',
      description:
        'Reduce overshoot on the force control loop so fragile payloads are not crushed during pick.',
      ownerKey: 'emp2',
      reviewerKey: 'mgr',
      supportKeys: ['emp1'],
      priority: 'P0',
      startInDays: -2,
      dueInDays: 0,
      dayOutcomes: [
        'Baseline step response captured on the current gains.',
        'Gain sweep run and overshoot measured at each setting.',
        'Final gains committed and the response plots attached.',
      ],
      createdDaysAgo: 6,
      status: 'in_progress',
      progress: 60,
      nextAction: 'Run the final gain sweep and capture the step response plots.',
      lastUpdatedDaysAgo: 0,
      comments: [{ authorKey: 'emp2', body: 'Overshoot down from 18% to 6%.', daysAgo: 1 }],
    },
    {
      key: 't-conveyor-po',
      milestoneKey: 'wa-proc-m1',
      title: 'Finalise conveyor motor purchase order',
      description: 'Confirm the motor specification with the vendor and release the purchase order.',
      ownerKey: 'emp3',
      reviewerKey: 'mgr',
      priority: 'P0',
      startInDays: -1,
      dueInDays: 0,
      dayOutcomes: [
        'Motor specification confirmed with the vendor.',
        'Finance sign-off obtained and the purchase order sent.',
      ],
      createdDaysAgo: 5,
      status: 'in_progress',
      progress: 70,
      nextAction: 'Get the finance sign-off signature and send the PO.',
      lastUpdatedDaysAgo: 0,
    },

    // --- overdue -----------------------------------------------------------
    {
      key: 't-dock-overshoot',
      milestoneKey: 'ad-nav-m1',
      title: 'Fix docking approach overshoot',
      description:
        'The robot overshoots the dock by roughly 12 mm on the final approach. Diagnose and correct.',
      ownerKey: 'emp1',
      reviewerKey: 'mgr',
      supportKeys: ['emp2'],
      priority: 'P0',
      startInDays: -4,
      dueInDays: -2,
      dayOutcomes: [
        'Overshoot reproduced on the test dock with logs captured.',
        'Cause traced through the approach controller gains.',
        'Fix applied and re-tested over ten approaches.',
      ],
      createdDaysAgo: 9,
      status: 'blocked',
      progress: 40,
      blocker: 'Waiting on the replacement IMU — the current unit drifts past spec after 20 minutes.',
      nextAction: 'Chase the supplier for the IMU dispatch date.',
      lastUpdatedDaysAgo: 1,
      comments: [
        {
          authorKey: 'emp1',
          body: 'Drift is reproducible on bench test, so it is the sensor rather than the controller.',
          daysAgo: 2,
        },
      ],
    },
    {
      key: 't-gripper-docs',
      milestoneKey: 'ad-man-m1',
      title: 'Document gripper maintenance procedure',
      description: 'Write the field maintenance procedure for the gripper assembly.',
      ownerKey: 'emp2',
      priority: 'P3',
      startInDays: -5,
      dueInDays: -4,
      dayOutcomes: [
        'Maintenance steps drafted from the service log.',
        'Procedure reviewed with the workshop and published.',
      ],
      createdDaysAgo: 16,
      status: 'in_progress',
      progress: 20,
      nextAction: 'Draft the disassembly section.',
      lastUpdatedDaysAgo: 8,
    },
    {
      key: 't-pick-acceptance',
      milestoneKey: 'wa-test-m1',
      title: 'Write acceptance test plan for pick station',
      description: 'Define the acceptance criteria and test procedure for the pick station handover.',
      ownerKey: 'emp2',
      reviewerKey: 'mgr',
      priority: 'P1',
      startInDays: -3,
      dueInDays: -1,
      dayOutcomes: [
        'Acceptance criteria agreed with the warehouse lead.',
        'Test cases written against each criterion.',
        'Plan circulated for review.',
      ],
      createdDaysAgo: 12,
      status: 'review',
      progress: 85,
      nextAction: 'Address the review comments on section 4.',
      evidenceUrl: 'https://example.com/demo/pick-station-acceptance-plan',
      dependsOnKeys: ['t-inventory-sync'],
      lastUpdatedDaysAgo: 1,
    },

    // --- due within two days ----------------------------------------------
    {
      key: 't-charging-contacts',
      milestoneKey: 'ad-hw-m1',
      deliverableKey: 'ad-hw-d1',
      title: 'Replace charging contact assembly',
      description:
        'Swap the charging contact assembly on all four dock units for the revision B design.',
      ownerKey: 'emp3',
      reviewerKey: 'mgr',
      priority: 'P1',
      startInDays: 2,
      dueInDays: 2,
      createdDaysAgo: 3,
      status: 'not_started',
      nextAction: 'Book the maintenance window with operations.',
      lastUpdatedDaysAgo: 6,
    },
    {
      key: 't-low-light',
      milestoneKey: 'ad-per-m1',
      title: 'Validate marker detection under low light',
      description: 'Measure detection rate at 50, 100 and 200 lux and record the failure modes.',
      ownerKey: 'emp2',
      supportKeys: ['emp1'],
      priority: 'P2',
      startInDays: -1,
      dueInDays: 1,
      dayOutcomes: [
        'Low-light rig assembled with calibrated lux levels.',
        'Detection runs captured across the lux range.',
        'Results written up against the pass threshold.',
      ],
      createdDaysAgo: 4,
      status: 'in_progress',
      progress: 30,
      nextAction: 'Finish the 50 lux run and log the false-negative cases.',
      lastUpdatedDaysAgo: 1,
    },
    {
      key: 't-light-curtains',
      milestoneKey: 'wa-proc-m1',
      title: 'Collect three quotes for safety light curtains',
      description: 'Gather comparable quotes from three suppliers for the pick station light curtains.',
      ownerKey: 'emp1',
      priority: 'P2',
      startInDays: 1,
      dueInDays: 2,
      dayOutcomes: [
        'Requirements sent to the three shortlisted suppliers.',
        'Quotes compared and a recommendation written.',
      ],
      createdDaysAgo: 5,
      status: 'not_started',
      lastUpdatedDaysAgo: 7,
    },

    // --- blocked, in flight -------------------------------------------------
    {
      key: 't-scanner-errors',
      milestoneKey: 'wa-sw-m1',
      title: 'Harden API error handling for scanner events',
      description:
        'The ingest API drops scanner events when the device reconnects. Add retry and dead-letter handling.',
      ownerKey: 'emp2',
      reviewerKey: 'mgr',
      priority: 'P2',
      startInDays: 3,
      dueInDays: 5,
      dayOutcomes: [
        'Error cases enumerated from the scanner event log.',
        'Retry and backoff handling implemented.',
        'Failure paths covered by tests.',
      ],
      createdDaysAgo: 8,
      status: 'blocked',
      progress: 35,
      blocker: 'Scanner vendor SDK crashes on reconnect; support ticket VND-8812 is open.',
      nextAction: 'Escalate the vendor ticket and prototype the workaround queue.',
      lastUpdatedDaysAgo: 5,
    },

    // --- healthy in-flight work ---------------------------------------------
    {
      key: 't-inventory-sync',
      milestoneKey: 'wa-sw-m1',
      deliverableKey: 'wa-sw-d1',
      title: 'Implement pallet inventory sync service',
      description:
        'Build the service that reconciles pallet positions between the WMS and the robot fleet.',
      ownerKey: 'emp1',
      reviewerKey: 'mgr',
      supportKeys: ['emp2'],
      priority: 'P1',
      startInDays: 1,
      dueInDays: 3,
      dayOutcomes: [
        'Sync contract agreed with the warehouse management system.',
        'Pallet reconciliation implemented against a sample feed.',
        'Service deployed to staging and verified end to end.',
      ],
      createdDaysAgo: 7,
      status: 'in_progress',
      progress: 45,
      nextAction: 'Wire up the reconciliation job and add the conflict metrics.',
      lastUpdatedDaysAgo: 1,
    },
    {
      key: 't-docking-metrics',
      milestoneKey: 'ad-nav-m1',
      title: 'Publish docking success metrics dashboard',
      description: 'Surface docking attempt, success and retry counts per robot per day.',
      ownerKey: 'emp3',
      reviewerKey: 'mgr',
      priority: 'P2',
      startInDays: 2,
      dueInDays: 4,
      dayOutcomes: [
        'Metric definitions confirmed with the manager.',
        'Dashboard built against the docking telemetry.',
        'Dashboard published and the link shared.',
      ],
      createdDaysAgo: 10,
      status: 'review',
      progress: 90,
      nextAction: 'Await review sign-off.',
      evidenceUrl: 'https://example.com/demo/docking-metrics-dashboard',
      dependsOnKeys: ['t-low-light'],
      lastUpdatedDaysAgo: 1,
    },

    // --- not started, further out -------------------------------------------
    {
      key: 't-regression-50',
      milestoneKey: 'ad-test-m1',
      title: 'Run 50-cycle autonomous docking regression',
      description:
        'Execute the full 50-cycle docking regression once the overshoot fix and gripper tuning land.',
      ownerKey: 'emp1',
      reviewerKey: 'mgr',
      supportKeys: ['emp2', 'emp3'],
      priority: 'P1',
      startInDays: 4,
      dueInDays: 6,
      dayOutcomes: [
        'Rig prepared and the 50-cycle script dry-run.',
        'Full regression executed with failures logged.',
        'Results summarised with pass rate and defects raised.',
      ],
      status: 'not_started',
      dependsOnKeys: ['t-dock-overshoot', 't-gripper-force'],
      lastUpdatedDaysAgo: 1,
    },
    {
      key: 't-telemetry-schema',
      milestoneKey: 'wa-sw-m1',
      title: 'Migrate warehouse telemetry to new schema',
      description: 'Move telemetry ingestion onto the v2 schema and backfill the last 30 days.',
      ownerKey: 'emp3',
      priority: 'P3',
      startInDays: 12,
      dueInDays: 12,
      status: 'not_started',
      lastUpdatedDaysAgo: 0,
    },
  ],

  deadlineRequests: [
    {
      taskKey: 't-charging-contacts',
      requestedByKey: 'emp3',
      // Within the span limit: a request the manager can actually approve.
      // Approving it stretches the task to three days, so the two new days
      // land on the clarification queue needing an outcome each.
      requestedDueInDays: 4,
      reason:
        'Operations can only release the dock for maintenance later in the week, so the current date is not reachable.',
      daysAgo: 1,
    },
  ],
};
