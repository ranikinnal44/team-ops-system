/**
 * ===========================================================================
 *                 AUTODOCK BUILD TIMELINE — THE FORWARD PLAN
 * ===========================================================================
 *
 * Source of truth: `Build Timeline.pdf`.
 *
 * Unlike the daily task log, this document DOES establish structure: phases,
 * milestones, which task belongs to which milestone, per-milestone timelines,
 * long-lead items, and dated outcomes. All of that is taken as given.
 *
 * WHAT THIS SOURCE DOES NOT ESTABLISH — and is therefore not invented:
 *   - owners      there is no owner column at all; all 28 tasks are unassigned
 *   - priorities  no P0-P3 anywhere
 *   - calendar dates: the plan is written in RELATIVE weeks (W1..W14). The
 *     anchor lives in `AUTODOCK_W1_START`, and every date below is derived
 *     from it at import time. The relative label is kept verbatim on each
 *     record so the plan survives re-anchoring.
 *
 * The "Long lead items/Dependencies" column holds external constraints and
 * risks ("Vendor delays", "Subbu's availability / Ashutosh leave"), not
 * task-to-task dependencies. They are stored against the milestone rather than
 * being forced into the dependency graph, which would assert links the source
 * never draws. Items the source highlights in red are marked `critical`.
 *
 * Task titles are lightly corrected for obvious typographic errors; the source
 * wording is preserved verbatim in each task's description.
 * ===========================================================================
 */

export type TimelineLongLeadItem = {
  text: string;
  /** Highlighted in red in the source. */
  critical?: boolean;
};

export type TimelineOutcome = {
  key: string;
  /** Verbatim text from the Outcomes and Deliverables column. */
  name: string;
  critical?: boolean;
};

export type TimelineTask = {
  key: string;
  /** Cleaned for display. */
  title: string;
  /** Verbatim source text. */
  sourceText: string;
};

export type TimelineMilestone = {
  key: string;
  name: string;
  /** Verbatim timeline cell, e.g. "W1 - W2". */
  timelineLabel: string;
  startWeek: number;
  endWeek: number;
  longLeadItems: TimelineLongLeadItem[];
  outcomes: TimelineOutcome[];
  tasks: TimelineTask[];
};

export type TimelinePhase = {
  key: string;
  code: string;
  name: string;
  /** Any qualifier the source prints under the phase name. */
  note?: string;
  milestones: TimelineMilestone[];
};

/**
 * The long-lead entries, separated into the two things the source mixes.
 *
 * Only four of the eleven are actually orderable with a stated lead time. The
 * rest are constraints ("Vendor delays", "Subbu's availability") that nobody
 * places an order for, so they are carried as risks with no dates rather than
 * given invented ones.
 */
export type SupplyItemSpec = {
  key: string;
  label: string;
  /** Verbatim text from the Long lead items column. */
  sourceText: string;
  kind: 'order' | 'risk';
  leadTimeWeeks?: number;
  critical?: boolean;
  /** Milestone the entry is listed against. */
  milestoneKey: string;
  /**
   * The outcome that releases the order, where the plan names one. Its date is
   * used as the order-by date in preference to working backwards.
   */
  orderByOutcomeKey?: string;
  /** Milestone that consumes it, where the plan lists it a second time. */
  neededAtMilestoneKey?: string;
  note?: string;
};

export type BuildTimelineDataset = {
  label: string;
  sourceDocument: string;
  /** Weeks the source marks as schedule buffer rather than work. */
  bufferWeeks: { week: number; after: string }[];
  softDeadlineWeek: number;
  hardDeadlineWeek: number;
  hardDeadlineNote: string;
  phases: TimelinePhase[];
  supply: SupplyItemSpec[];
};

const SUPPLY: SupplyItemSpec[] = [
  // --- the four with a stated lead time ----------------------------------
  {
    key: 'sup-vfd',
    label: 'VFD',
    sourceText: 'VFD procurement - 8 week',
    kind: 'order',
    leadTimeWeeks: 8,
    critical: true,
    milestoneKey: 'mds-elec-arch',
    orderByOutcomeKey: 'mds-o3', // "VFD order release by W1 end"
    note:
      'The plan states when to order it but never says which milestone consumes it, so there is ' +
      'no needed-by date to check the arrival against. Confirm when it has to be on site.',
  },
  {
    key: 'sup-pneumatic',
    label: 'Pneumatic system',
    sourceText: 'Pneumatic setup - 8 week / Compressor Test setup clarity',
    kind: 'order',
    leadTimeWeeks: 8,
    critical: true,
    milestoneKey: 'mds-elec-arch',
    orderByOutcomeKey: 'mds-o6', // "Pneumatic system order release by W2"
    // Listed a second time against the milestone that consumes it.
    neededAtMilestoneKey: 'amp-electronics',
    note:
      'The plan already anticipates this slipping: the electronics placement outcome reads ' +
      '"by W10 (in case of pneumatic system procurement delays)".',
  },
  {
    key: 'sup-mech',
    label: 'Mechanical parts',
    sourceText: 'Mechanical Procurement - 2 week',
    kind: 'order',
    leadTimeWeeks: 2,
    milestoneKey: 'amp-chassis',
    neededAtMilestoneKey: 'amp-chassis',
  },
  {
    key: 'sup-elec',
    label: 'Electrical parts',
    sourceText: 'Electrical Procurement - 2 week',
    kind: 'order',
    leadTimeWeeks: 2,
    milestoneKey: 'amp-routing',
    neededAtMilestoneKey: 'amp-routing',
  },

  // --- constraints with nothing to order ----------------------------------
  {
    key: 'sup-subbu',
    label: "Subbu's availability / Ashutosh leave",
    sourceText: "Subbu's availability / Ashutosh leave",
    kind: 'risk',
    milestoneKey: 'mds-final-design',
  },
  {
    key: 'sup-battery',
    label: 'Battery sizing and selection',
    sourceText: 'Battery Sizing and selection',
    kind: 'risk',
    milestoneKey: 'mds-elec-arch',
  },
  {
    key: 'sup-acdc',
    label: 'AC/AC-DC architecture clarity',
    sourceText: 'AC/AC-DC architecture clarity for rest of electronics procurement',
    kind: 'risk',
    milestoneKey: 'mds-elec-arch',
    note: 'Blocks the rest of the electronics procurement until it is settled.',
  },
  {
    key: 'sup-vendor',
    label: 'Vendor delays',
    sourceText: 'Vendor delays',
    kind: 'risk',
    milestoneKey: 'mds-procurement',
  },
  {
    key: 'sup-sensors',
    label: 'Sensors and chassis disassembly',
    sourceText: 'Sensors and chassis dissasembly',
    kind: 'risk',
    milestoneKey: 'amp-electronics',
  },
  {
    key: 'sup-testcases',
    label: 'Test cases documentation with clear outcomes',
    sourceText: 'Test cases documentation with clear outcomes',
    kind: 'risk',
    milestoneKey: 'amp-mobility',
  },
];

export const BUILD_TIMELINE: BuildTimelineDataset = {
  label: 'AUTODOCK BUILD TIMELINE — forward plan (Stream 1)',
  sourceDocument: 'Build Timeline.pdf (phased build plan, W1–W14, Stream 1)',
  bufferWeeks: [
    { week: 3, after: 'Final Design Validation' },
    { week: 5, after: 'Mechanical and Electrical Procurement' },
  ],
  softDeadlineWeek: 12,
  hardDeadlineWeek: 14,
  hardDeadlineNote: 'Assuming delays with buffers',

  supply: SUPPLY,
  phases: [
    {
      key: 'mds',
      code: 'MDS',
      name: 'Mechanical Design',
      milestones: [
        {
          key: 'mds-final-design',
          name: 'Final Design Validation',
          timelineLabel: 'W1 - W2',
          startWeek: 1,
          endWeek: 2,
          longLeadItems: [{ text: "Subbu's availability / Ashutosh leave" }],
          outcomes: [
            { key: 'mds-o1', name: 'Product Ready design check list by W1' },
            {
              key: 'mds-o2',
              name: 'Design and simulation validation discussion with subbu by W2',
            },
          ],
          tasks: [
            { key: 'bt-001', title: 'Proto Ready Design', sourceText: 'Proto Ready Design' },
            {
              key: 'bt-002',
              title: 'Product Ready — design version checks',
              sourceText: 'Product Ready - design version checks',
            },
            {
              key: 'bt-003',
              title: 'Simulation reports and analysis validation',
              sourceText: 'Simulation reports and analysis validation',
            },
          ],
        },
        {
          key: 'mds-elec-arch',
          name: 'Electrical and Electronics Architecture',
          timelineLabel: 'W1 - W2',
          startWeek: 1,
          endWeek: 2,
          longLeadItems: [
            { text: 'VFD procurement - 8 week', critical: true },
            { text: 'Battery Sizing and selection' },
            { text: 'AC/AC-DC architecture clarity for rest of electronics procurement' },
            { text: 'Pneumatic setup - 8 week / Compressor Test setup clarity', critical: true },
          ],
          outcomes: [
            { key: 'mds-o3', name: 'VFD order release by W1 end', critical: true },
            {
              key: 'mds-o4',
              name: 'Final power distribution architecture for proto design by W2',
            },
            { key: 'mds-o5', name: 'Final pneumatic system approach for proto design by W2' },
            { key: 'mds-o6', name: 'Pneumatic system order release by W2', critical: true },
            { key: 'mds-o7', name: 'Cabin layout and routing diagram/2D/3D' },
          ],
          tasks: [
            {
              key: 'bt-004',
              title: 'Final power distribution',
              sourceText: 'Final Power distribution',
            },
            {
              key: 'bt-005',
              title: 'Cabin design and layout',
              sourceText: 'Cabin Design and layout',
            },
            { key: 'bt-006', title: 'Battery sizing', sourceText: 'Battery sizing' },
            {
              key: 'bt-007',
              title: 'Power distribution planning',
              sourceText: 'Power distribution planning',
            },
            {
              key: 'bt-008',
              title: 'Final electronics components sheet',
              sourceText: 'Final Electronics Components Sheet',
            },
          ],
        },
        {
          key: 'mds-procurement',
          name: 'Mechanical and Electrical Procurement',
          timelineLabel: 'W3 - W4',
          startWeek: 3,
          endWeek: 4,
          longLeadItems: [{ text: 'Vendor delays' }],
          outcomes: [
            {
              key: 'mds-o8',
              name: 'Component procurement and visual inspection validation for damages',
            },
          ],
          tasks: [
            {
              key: 'bt-009',
              title: 'Part fabrication and welding',
              sourceText: 'Part fabrication and welding',
            },
            {
              key: 'bt-010',
              title: 'Electrical components order release',
              sourceText: 'Electrical COmponents order release',
            },
          ],
        },
      ],
    },

    {
      key: 'wts',
      code: 'WTS',
      name: 'Warehouse Testing Space',
      milestones: [
        {
          key: 'wts-rental',
          name: 'Warehouse Rental Space',
          timelineLabel: 'W1 - W4',
          startWeek: 1,
          endWeek: 4,
          longLeadItems: [],
          outcomes: [],
          tasks: [
            {
              key: 'bt-011',
              title: 'Selection and go ahead',
              sourceText: 'Selectio and go ahead',
            },
            { key: 'bt-012', title: 'Agreements and legal', sourceText: 'Agreements and legal' },
            {
              key: 'bt-013',
              title: 'Construction/civil changes',
              sourceText: 'Construction/civil changes',
            },
            {
              key: 'bt-014',
              title: 'Check with Able Robotics / other similar partners',
              sourceText: 'Check with able robotics/other similar partners',
            },
          ],
        },
      ],
    },

    {
      key: 'amp',
      code: 'AMP',
      name: 'Autonomous Mobile Platform',
      note: 'Warehouse Dependency',
      milestones: [
        {
          key: 'amp-chassis',
          name: 'Chassis Fabrication and Assembly',
          timelineLabel: 'W4 - W6',
          startWeek: 4,
          endWeek: 6,
          longLeadItems: [{ text: 'Mechanical Procurement - 2 week' }],
          outcomes: [
            { key: 'amp-o1', name: 'Chassis assembly with drive system by W6' },
            { key: 'amp-o2', name: 'Intern/Engineer hiring', critical: true },
          ],
          tasks: [
            { key: 'bt-015', title: 'Chassis assembly', sourceText: 'Chassis assembly' },
            {
              key: 'bt-016',
              title: 'Wheel and drive assembly',
              sourceText: 'Wheel and drive assembly',
            },
            { key: 'bt-017', title: 'Fitment check', sourceText: 'Fitment check' },
          ],
        },
        {
          key: 'amp-routing',
          name: 'Electrical Routing and Assembly',
          timelineLabel: 'W5 - W8',
          startWeek: 5,
          endWeek: 8,
          longLeadItems: [{ text: 'Electrical Procurement - 2 week' }],
          outcomes: [{ key: 'amp-o3', name: 'Electrical routing completion by W8' }],
          tasks: [
            {
              key: 'bt-018',
              title: 'Cable routing and protection',
              sourceText: 'Cable routing and protection',
            },
            { key: 'bt-019', title: 'Cabin assembly', sourceText: 'Cabin assembly' },
          ],
        },
        {
          key: 'amp-electronics',
          name: 'Electronics Component Placement and Assembly',
          timelineLabel: 'W5 - W10',
          startWeek: 5,
          endWeek: 10,
          longLeadItems: [
            { text: 'Sensors and chassis dissasembly' },
            { text: 'Pneumatic setup - 8 week', critical: true },
          ],
          outcomes: [
            {
              key: 'amp-o4',
              name: 'Electronics component placement by W10 (in case of pneumatic system procurement delays)',
            },
          ],
          tasks: [
            {
              key: 'bt-020',
              title: 'Component procurement',
              sourceText: 'Component procurement',
            },
            {
              key: 'bt-021',
              title: 'Controller and sensor placement',
              sourceText: 'Controller and sensor placement',
            },
            { key: 'bt-022', title: 'Power connections', sourceText: 'Power connections' },
            {
              key: 'bt-023',
              title: 'Wiring and connector assembly',
              sourceText: 'Wiring and connector assembly',
            },
            {
              key: 'bt-024',
              title: 'Basic power-up testing',
              sourceText: 'Basic power-up testing',
            },
          ],
        },
        {
          key: 'amp-mobility',
          name: 'Mobility Testing',
          timelineLabel: 'W8 - W12',
          startWeek: 8,
          endWeek: 12,
          longLeadItems: [{ text: 'Test cases documentation with clear outcomes' }],
          outcomes: [
            { key: 'amp-o5', name: 'Final test results and go ahead for integration' },
          ],
          tasks: [
            { key: 'bt-025', title: 'Drive system testing', sourceText: 'Drive system testing' },
            {
              key: 'bt-026',
              title: 'Forward/reverse movement testing',
              sourceText: 'Forward/reverse movement testing',
            },
            {
              key: 'bt-027',
              title: 'Turning and stopping tests',
              sourceText: 'Turning and stopping tests',
            },
            {
              key: 'bt-028',
              title: 'Payload movement testing',
              sourceText: 'Payload movement testing',
            },
          ],
        },
      ],
    },
  ],
};

/** Every task in the plan, flattened, with its milestone and phase. */
export function flattenTimelineTasks(
  dataset: BuildTimelineDataset = BUILD_TIMELINE,
): { phase: TimelinePhase; milestone: TimelineMilestone; task: TimelineTask }[] {
  return dataset.phases.flatMap((phase) =>
    phase.milestones.flatMap((milestone) =>
      milestone.tasks.map((task) => ({ phase, milestone, task })),
    ),
  );
}
