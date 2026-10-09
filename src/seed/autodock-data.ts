/**
 * ===========================================================================
 *                    AUTODOCK — REAL PROJECT DATA (IMPORTED)
 * ===========================================================================
 *
 * Source of truth: `Daily task.pdf` — the team's daily task log, 56 rows
 * covering 10 Sep 2026 to 23 Sep 2026.
 *
 * The source document is a spreadsheet split across pages: Date + Owner on
 * pages 1-2, the task text on pages 3-4, and Timeline + Note on pages 5-6.
 * Row alignment was confirmed against two independent cross-checks:
 *   - row 2's note "FreeCAD / Solidworks / Explore prompting" matches its task
 *     "R&D which software makes best case for this testing and analysis";
 *   - row 48 (Rani, "Demo Video & Animation Updates") carries the timeline
 *     "Transfer to Ashutosh", and row 55 is the same task owned by Ashutosh.
 *
 * WHAT THE SOURCE DOES NOT CONTAIN — and is therefore NOT invented here:
 *   - due dates          (the Date column is the log date, not a deadline)
 *   - priorities         (no P0-P3 anywhere in the document)
 *   - dependencies       (ordering in the sheet does not establish one)
 *   - reviewers          (except row 56, "Reviewed by Rani")
 *   - deliverables       (only where the source names a concrete artefact)
 *
 * WHAT IS AN IMPORTER JUDGEMENT, recorded as such:
 *   - workstream classification for every row (low-confidence rows carry
 *     `classificationUncertain` and surface in the clarification queue);
 *   - milestone grouping, created only where two or more tasks in the same
 *     workstream plainly drive the same outcome.
 *
 * Several task descriptions are visibly cut off in the supplied PDF (the
 * column was too narrow). Those rows are marked `truncated` and the text is
 * kept exactly as supplied rather than being completed from guesswork.
 * ===========================================================================
 */
import type { Role } from '../domain/enums.ts';
import type { SourceTaskRecord } from './source-record.ts';

export type AutoDockUser = {
  key: string;
  name: string;
  email: string;
  role: Role;
  title: string | null;
};

export type AutoDockMilestone = {
  key: string;
  name: string;
  /** Why this grouping was derived from the source. */
  rationale: string;
  deliverables?: { key: string; name: string }[];
};

export type AutoDockWorkstream = {
  key: string;
  code: string;
  name: string;
  milestones: AutoDockMilestone[];
};

export type AutoDockDataset = {
  label: string;
  sourceDocument: string;
  project: { code: string; name: string; description: string; leadKey: string };
  users: AutoDockUser[];
  workstreams: AutoDockWorkstream[];
  tasks: SourceTaskRecord[];
};

/**
 * Roles come from the brief: Rani is the Task Assigner, everyone else a Member.
 * Nothing in the source document establishes a role beyond task ownership, so
 * nothing further is inferred.
 */
const USERS: AutoDockUser[] = [
  { key: 'rani', name: 'Rani', email: 'rani@example.com', role: 'manager', title: null },
  { key: 'firaz', name: 'Firaz', email: 'firaz@example.com', role: 'employee', title: null },
  { key: 'ashutosh', name: 'Ashutosh', email: 'ashutosh@example.com', role: 'employee', title: null },
  { key: 'mallikarjun', name: 'Mallikarjun', email: 'mallikarjun@example.com', role: 'employee', title: null },
  { key: 'faizan', name: 'Faizan', email: 'faizan@example.com', role: 'employee', title: null },
];

const WORKSTREAMS: AutoDockWorkstream[] = [
  {
    key: 'mec',
    code: 'MEC',
    name: 'Mechanical Design',
    milestones: [],
  },
  {
    key: 'man',
    code: 'MAN',
    name: 'Manipulation & Robotics',
    milestones: [
      {
        key: 'man-arm-selection',
        name: 'Robotic Arm Selection',
        rationale:
          'Rows 41 and 44 both drive the choice of arm: a Chinese-arm vs FANUC comparison and ' +
          'vendor confirmation of the 20 kg payload/moment figures.',
        deliverables: [{ key: 'man-arm-table', name: 'Chinese arm vs FANUC comparison table' }],
      },
    ],
  },
  {
    key: 'cnv',
    code: 'CNV',
    name: 'Conveyor & Dock Integration',
    milestones: [
      {
        key: 'cnv-coupling',
        name: 'Conveyor Coupling Selection',
        rationale:
          'Rows 4, 27, 28, 29, 30, 46 and 52 form one continuous thread: researching how the ' +
          'flexible conveyor joins the main conveyor, and compiling the options into one sheet.',
        deliverables: [
          { key: 'cnv-coupling-sheet', name: 'Connector/coupling comparison sheet (4-10 types)' },
        ],
      },
    ],
  },
  {
    key: 'ele',
    code: 'ELE',
    name: 'Electrical & Control Panel',
    milestones: [
      {
        key: 'ele-panel-layout',
        name: 'Control Panel Layout',
        rationale:
          'Rows 12, 19, 20, 32 and 37 all drive one outcome: a control panel layout that fits ' +
          'the estimated 600x450 area, built in FreeCAD.',
      },
    ],
  },
  {
    key: 'sim',
    code: 'SIM',
    name: 'Simulation',
    milestones: [
      {
        key: 'sim-latch',
        name: 'Latch Simulation in SolidWorks',
        rationale:
          'Rows 2, 3, 36 and 54 run from choosing the simulation tool, through checking its ' +
          'capability for the moving robot/conveyor latch impact, to performing the simulation.',
      },
      {
        key: 'sim-stack',
        name: 'Robot Stack Simulation',
        rationale:
          'Rows 39 and 43 both concern running the manipulation stack in simulation ' +
          '(Gazebo, and Isaac with the Chinese arm configuration).',
      },
    ],
  },
  {
    key: 'tst',
    code: 'TST',
    name: 'Testing & Validation',
    milestones: [
      {
        key: 'tst-latch-doc',
        name: 'Latch Testing Documentation',
        rationale:
          'Rows 1, 31, 35 and 53 all feed one artefact the source names repeatedly: the latch ' +
          'testing document and its parameters/test cases.',
        deliverables: [{ key: 'tst-latch-document', name: 'Latch testing document' }],
      },
    ],
  },
  {
    key: 'prc',
    code: 'PRC',
    name: 'Procurement & Vendors',
    milestones: [
      {
        key: 'prc-containers',
        name: 'Container Sourcing',
        rationale:
          'Rows 10, 15, 16, 17 and 22 all concern sourcing truck containers: vendors, ' +
          'availability of old units, foldable options and pricing.',
      },
    ],
  },
  {
    key: 'mkt',
    code: 'MKT',
    name: 'Product / Market Research',
    milestones: [],
  },
  {
    key: 'doc',
    code: 'DOC',
    name: 'Demo & Documentation',
    milestones: [
      {
        key: 'doc-demo-video',
        name: 'Demo Video Production',
        rationale:
          'Rows 6, 25, 40, 48 and 55 all feed the demo video: Blender stills, model updates, ' +
          'the planning call with Yash, and the animation changes (transferred mid-flight).',
      },
    ],
  },
  {
    key: 'dep',
    code: 'DEP',
    name: 'Deployment / Site Readiness',
    milestones: [],
  },
];

/**
 * The 56 source rows, in document order. `sourceRef` is DTL-<row number> so
 * every record can be traced back to a line of the original sheet.
 */
const TASKS: SourceTaskRecord[] = [
  // --- 10 Sep 2026 --------------------------------------------------------
  {
    sourceRef: 'DTL-001',
    sourceDate: '2026-09-10',
    sourceOwnerLabel: 'Firaz',
    ownerKey: 'firaz',
    title: 'List the test parameters to be arrived at after testing',
    description: 'List the params we need to arrive after testing - validate with faizan',
    sourceStatus: 'Done',
    workstreamKey: 'tst',
    milestoneKey: 'tst-latch-doc',
    supportKeys: ['faizan'],
    supportInferredFrom: 'validate with faizan',
  },
  {
    sourceRef: 'DTL-002',
    sourceDate: '2026-09-10',
    sourceOwnerLabel: 'Firaz',
    ownerKey: 'firaz',
    title: 'R&D which software is the best fit for testing and analysis',
    description: 'R&D which software makes best case for this testing and analysis',
    sourceStatus: 'Done',
    sourceNote: 'FreeCAD / Solidworks / Explore prompting',
    workstreamKey: 'sim',
    milestoneKey: 'sim-latch',
  },
  {
    sourceRef: 'DTL-003',
    sourceDate: '2026-09-10',
    sourceOwnerLabel: 'Firaz',
    ownerKey: 'firaz',
    title: 'Simulate the latch and establish current design tolerances',
    description:
      'Simulate the latch in a software and arrive at the current design tolerances in terms of weights, forces etc',
    sourceStatus: 'Done',
    workstreamKey: 'sim',
    milestoneKey: 'sim-latch',
  },
  {
    sourceRef: 'DTL-004',
    sourceDate: '2026-09-10',
    sourceOwnerLabel: 'Firaz',
    ownerKey: 'firaz',
    title: 'R&D integration feasibility of flexible conveyor with main conveyor',
    description: 'R&D of integration feasiability with flexible conveyor of main conveyor',
    sourceStatus: 'Done',
    workstreamKey: 'cnv',
    milestoneKey: 'cnv-coupling',
  },
  {
    sourceRef: 'DTL-005',
    sourceDate: '2026-09-10',
    sourceOwnerLabel: 'Ashutosh',
    ownerKey: 'ashutosh',
    title: 'Define outcomes and timeline to complete the proto design',
    description: 'Define outcomes and timeline for the tasks indicated to complete proto design',
    sourceStatus: 'EOD',
    workstreamKey: 'mec',
  },
  {
    sourceRef: 'DTL-006',
    sourceDate: '2026-09-10',
    sourceOwnerLabel: 'Ashutosh',
    ownerKey: 'ashutosh',
    title: 'Blender images 4 - 5',
    description: 'Blender images 4 - 5',
    sourceStatus: 'Done',
    workstreamKey: 'doc',
    milestoneKey: 'doc-demo-video',
  },
  {
    sourceRef: 'DTL-007',
    sourceDate: '2026-09-10',
    sourceOwnerLabel: 'Ashutosh',
    ownerKey: 'ashutosh',
    title: 'Conveyor design validation',
    description: 'Conveyor design validation',
    sourceStatus: 'Running',
    workstreamKey: 'cnv',
    duplicateNote:
      'Overlaps DTL-008 ("Need to validate as a design from functionality POV"), which sits ' +
      'immediately after it under the same owner and date. Confirm whether these are one task.',
  },
  {
    sourceRef: 'DTL-008',
    sourceDate: '2026-09-10',
    sourceOwnerLabel: 'Ashutosh',
    ownerKey: 'ashutosh',
    title: 'Validate the design from a functionality point of view',
    description: 'Need to validate as a design from functionality POV',
    sourceStatus: null,
    workstreamKey: 'mec',
    classificationUncertain:
      'The row does not say which design is being validated. Placed under Mechanical Design ' +
      'because it follows the conveyor design validation row; confirm the intended scope.',
    duplicateNote: 'May be the same work as DTL-007 ("Conveyor design validation").',
  },
  {
    sourceRef: 'DTL-009',
    sourceDate: '2026-09-10',
    sourceOwnerLabel: 'Mallikarjun',
    ownerKey: 'mallikarjun',
    title: 'Table comparative',
    description: 'Table comparative',
    sourceStatus: 'Done',
    workstreamKey: 'prc',
    classificationUncertain:
      'Two words with no object. Placed under Procurement & Vendors because the owner’s ' +
      'other rows that day concern container comparisons. Confirm what was compared.',
  },
  {
    sourceRef: 'DTL-010',
    sourceDate: '2026-09-10',
    sourceOwnerLabel: 'Mallikarjun',
    ownerKey: 'mallikarjun',
    title: 'Folding container possibilities and cost',
    description: 'Folding container possibilities and cost',
    sourceStatus: 'Done',
    workstreamKey: 'prc',
    milestoneKey: 'prc-containers',
  },
  {
    sourceRef: 'DTL-011',
    sourceDate: '2026-09-10',
    sourceOwnerLabel: 'Mallikarjun',
    ownerKey: 'mallikarjun',
    title: 'Electrical cabin design - duct',
    description: 'Electrical cabin design - duct',
    sourceStatus: 'Running',
    workstreamKey: 'ele',
  },
  {
    sourceRef: 'DTL-012',
    sourceDate: '2026-09-10',
    sourceOwnerLabel: 'Mallikarjun',
    ownerKey: 'mallikarjun',
    title: 'Section wise placement',
    description: 'Section Wise Placement',
    sourceStatus: 'Running',
    workstreamKey: 'ele',
    milestoneKey: 'ele-panel-layout',
  },
  {
    sourceRef: 'DTL-013',
    sourceDate: '2026-09-10',
    sourceOwnerLabel: 'Mallikarjun',
    ownerKey: 'mallikarjun',
    title: 'Wiring',
    description: 'Wiring',
    sourceStatus: 'Running',
    workstreamKey: 'ele',
  },

  // --- 15 Sep 2026 --------------------------------------------------------
  {
    sourceRef: 'DTL-014',
    sourceDate: '2026-09-15',
    sourceOwnerLabel: 'Rani',
    ownerKey: 'rani',
    title: 'Coordinate and review the Infosys PPT discussion',
    description: 'Coordinate/review the Infosys PPT discussion and provide feedback/input as required',
    sourceStatus: 'Done',
    workstreamKey: 'doc',
  },
  {
    sourceRef: 'DTL-015',
    sourceDate: '2026-09-15',
    sourceOwnerLabel: 'Mallikarjun',
    ownerKey: 'mallikarjun',
    title: 'Identify truck container vendors and collect availability and pricing',
    description:
      'Identify vendors for truck containers and collect container availability and pricing details',
    sourceStatus: 'Done',
    workstreamKey: 'prc',
    milestoneKey: 'prc-containers',
  },
  {
    sourceRef: 'DTL-016',
    sourceDate: '2026-09-15',
    sourceOwnerLabel: 'Mallikarjun',
    ownerKey: 'mallikarjun',
    title: 'Follow up with vendors on availability of old containers',
    description: 'Follow up with vendors regarding availability of old containers',
    sourceStatus: 'Done',
    workstreamKey: 'prc',
    milestoneKey: 'prc-containers',
  },
  {
    sourceRef: 'DTL-017',
    sourceDate: '2026-09-15',
    sourceOwnerLabel: 'Mallikarjun',
    ownerKey: 'mallikarjun',
    title: 'Check feasibility of foldable/detachable containers with shortlisted vendors',
    description: 'Check feasibility of foldable/detachable containers with shortlisted vendors',
    sourceStatus: 'Done',
    workstreamKey: 'prc',
    milestoneKey: 'prc-containers',
  },
  {
    sourceRef: 'DTL-018',
    sourceDate: '2026-09-15',
    sourceOwnerLabel: 'Mallikarjun',
    ownerKey: 'mallikarjun',
    title: 'Prepare warehouse floor plan and estimate required warehouse size',
    description: 'Prepare warehouse floor plan and estimate required warehouse size',
    sourceStatus: 'Done',
    workstreamKey: 'dep',
  },
  {
    sourceRef: 'DTL-019',
    sourceDate: '2026-09-15',
    sourceOwnerLabel: 'Mallikarjun',
    ownerKey: 'mallikarjun',
    title: 'Install and integrate FreeCAD with Claude for control panel drawings',
    description: 'Install and integrate FreeCAD with Claude for control panel drawing support',
    sourceStatus: 'Done',
    workstreamKey: 'ele',
    milestoneKey: 'ele-panel-layout',
  },
  {
    sourceRef: 'DTL-020',
    sourceDate: '2026-09-15',
    sourceOwnerLabel: 'Mallikarjun',
    ownerKey: 'mallikarjun',
    title: 'Segregate control panel components based on power input',
    description: 'Segregate control panel components based on power input',
    sourceStatus: 'Done',
    workstreamKey: 'ele',
    milestoneKey: 'ele-panel-layout',
  },
  {
    sourceRef: 'DTL-021',
    sourceDate: '2026-09-15',
    sourceOwnerLabel: 'Mallikarjun',
    ownerKey: 'mallikarjun',
    title: 'Verify CE/FCC/EU certification requirements for electronics, arm and gripper',
    description: 'Verify CE/FCC/EU certification requirements for electronic components, arm and gripper',
    sourceStatus: null,
    workstreamKey: 'dep',
    classificationUncertain:
      'Regulatory certification does not map cleanly onto any of the ten workstreams. Placed ' +
      'under Deployment / Site Readiness as the closest fit; a Compliance workstream may be needed.',
  },
  {
    sourceRef: 'DTL-022',
    sourceDate: '2026-09-15',
    sourceOwnerLabel: 'Mallikarjun',
    ownerKey: 'mallikarjun',
    title: 'Truck containers: find units and price old and foldable options',
    description:
      'Truck containers: Find truck containers, get estimated price for old containers and foldable containers',
    sourceStatus: 'Done',
    workstreamKey: 'prc',
    milestoneKey: 'prc-containers',
    duplicateNote:
      'Substantially overlaps DTL-015, DTL-016 and DTL-017 from the same day and owner. Kept as ' +
      'a separate record because the source lists it separately; confirm whether it is a summary row.',
  },

  // --- 16 Sep 2026 --------------------------------------------------------
  {
    sourceRef: 'DTL-023',
    sourceDate: '2026-09-16',
    sourceOwnerLabel: 'Rani',
    ownerKey: 'rani',
    title: 'Update Euro procurement costs for the product sheet',
    description: 'Euro Procurement Costs Updated for Product Sheet',
    sourceStatus: 'Done',
    workstreamKey: 'prc',
  },
  {
    sourceRef: 'DTL-024',
    sourceDate: '2026-09-16',
    sourceOwnerLabel: 'Rani',
    ownerKey: 'rani',
    title: 'Align with Subbu and Rajeev on the TVS slides',
    description: 'Aligned with Subbu and Rajeev on TVS slides',
    sourceStatus: 'Done',
    workstreamKey: 'doc',
  },
  {
    sourceRef: 'DTL-025',
    sourceDate: '2026-09-16',
    sourceOwnerLabel: 'Rani',
    ownerKey: 'rani',
    title: 'Define model updates needed for the video',
    description: 'Defined model updates needed for video and discussed with ashutosh',
    sourceStatus: 'Done',
    workstreamKey: 'doc',
    milestoneKey: 'doc-demo-video',
    supportKeys: ['ashutosh'],
    supportInferredFrom: 'discussed with ashutosh',
  },
  {
    sourceRef: 'DTL-026',
    sourceDate: '2026-09-16',
    sourceOwnerLabel: 'Rani',
    ownerKey: 'rani',
    title: 'Prepare first-round screening questions for the Robotics Hardware Engineer role',
    description: 'First round Screening questions prepped for Robotics Hardware Engineer role',
    sourceStatus: 'Done',
    workstreamKey: 'mkt',
    classificationUncertain:
      'Hiring activity does not belong to any of the ten defined workstreams. Parked under ' +
      'Product / Market Research so it is not lost; a Team & Hiring workstream is likely needed.',
  },

  // --- 17 Sep 2026 --------------------------------------------------------
  {
    sourceRef: 'DTL-027',
    sourceDate: '2026-09-17',
    sourceOwnerLabel: 'Firaz',
    ownerKey: 'firaz',
    title: 'Research ready-made connectors and couplings for conveyor connections',
    description:
      'Flexible conveyor and main conveyor connections: research ready-made connectors/couplings and explore generic options fo',
    sourceStatus: 'In Progress',
    workstreamKey: 'cnv',
    milestoneKey: 'cnv-coupling',
    truncated: true,
  },
  {
    sourceRef: 'DTL-028',
    sourceDate: '2026-09-17',
    sourceOwnerLabel: 'Firaz',
    ownerKey: 'firaz',
    title: 'Summarise 4-10 connector/coupling types in a comparison sheet',
    description:
      'Prepare a complete document/Excel sheet summarizing 4-10 connector/coupling types to evaluate suitability',
    sourceStatus: 'Planned',
    workstreamKey: 'cnv',
    milestoneKey: 'cnv-coupling',
    deliverableKey: 'cnv-coupling-sheet',
  },
  {
    sourceRef: 'DTL-029',
    sourceDate: '2026-09-17',
    sourceOwnerLabel: 'Firaz',
    ownerKey: 'firaz',
    title: 'Collect connector parameters and recommendations from Ashutosh',
    description: 'Collect connector parameters and recommendations from Ashutosh based on customer requirements',
    sourceStatus: 'Planned',
    workstreamKey: 'cnv',
    milestoneKey: 'cnv-coupling',
    supportKeys: ['ashutosh'],
    supportInferredFrom: 'recommendations from Ashutosh',
  },
  {
    sourceRef: 'DTL-030',
    sourceDate: '2026-09-17',
    sourceOwnerLabel: 'Firaz',
    ownerKey: 'firaz',
    title: 'Contact conveyor vendors for technical details on connectors and couplings',
    description: 'Contact conveyor vendors to gather further technical details on connectors and couplings',
    sourceStatus: 'In Progress',
    workstreamKey: 'cnv',
    milestoneKey: 'cnv-coupling',
  },
  {
    sourceRef: 'DTL-031',
    sourceDate: '2026-09-17',
    sourceOwnerLabel: 'Firaz',
    ownerKey: 'firaz',
    title: 'Complete the listing of latch parameters for SolidWorks testing',
    description: 'Complete listing of latch parameters for SolidWorks testing/analysis',
    sourceStatus: 'In Progress',
    workstreamKey: 'tst',
    milestoneKey: 'tst-latch-doc',
    deliverableKey: 'tst-latch-document',
  },
  {
    sourceRef: 'DTL-032',
    sourceDate: '2026-09-17',
    sourceOwnerLabel: 'Mallikarjun',
    ownerKey: 'mallikarjun',
    title: 'Build a mock control panel placement in FreeCAD',
    description:
      'Control Panel Design: Build mock placement control panel in Free CAD, integrate Free CAD and Claude to try 3D parts placem',
    sourceStatus: 'In Progress',
    workstreamKey: 'ele',
    milestoneKey: 'ele-panel-layout',
    truncated: true,
    decompositionNote:
      'Contains two activities: building the mock placement, and integrating FreeCAD with Claude ' +
      'for 3D parts placement. Split if they need separate tracking.',
  },
  {
    sourceRef: 'DTL-033',
    sourceDate: '2026-09-17',
    sourceOwnerLabel: 'Mallikarjun',
    ownerKey: 'mallikarjun',
    title: 'Clean up the components BOM and attach quotations and datasheets',
    description:
      'BOM: Clean up OneDrive components BOM, add details in electronic components sheet, add all quotations and datasheets fo',
    sourceStatus: 'In Progress',
    workstreamKey: 'prc',
    truncated: true,
    decompositionNote:
      'Contains three activities: cleaning the BOM, adding electronic component details, and ' +
      'attaching quotations/datasheets. Split if they need separate tracking.',
  },

  // --- 18 Sep 2026 --------------------------------------------------------
  {
    sourceRef: 'DTL-034',
    sourceDate: '2026-09-18',
    sourceOwnerLabel: 'Rani',
    ownerKey: 'rani',
    title: 'Conduct market research to identify target markets for prototype deployment',
    description: 'Market Study: Conduct market research to identify target markets for prototype deployment',
    sourceStatus: 'Done',
    workstreamKey: 'mkt',
  },
  {
    sourceRef: 'DTL-035',
    sourceDate: '2026-09-18',
    sourceOwnerLabel: 'Firaz',
    ownerKey: 'firaz',
    title: 'Document physical test parameters in the testing document',
    description:
      'Physical Testing Documentation: Document physical test parameters (such as payload test) in the testing document',
    sourceStatus: 'Done',
    workstreamKey: 'tst',
    milestoneKey: 'tst-latch-doc',
    deliverableKey: 'tst-latch-document',
  },
  {
    sourceRef: 'DTL-036',
    sourceDate: '2026-09-18',
    sourceOwnerLabel: 'Firaz / Ashutosh',
    ownerKey: 'firaz',
    supportKeys: ['ashutosh'],
    ownerUnclear: true,
    title: 'Check SolidWorks simulation capability for robot/conveyor latch impact',
    description: 'Simulation Evaluation: Check SolidWorks simulation capabilities for moving robot/conveyor latch impact',
    sourceStatus: 'Done',
    workstreamKey: 'sim',
    milestoneKey: 'sim-latch',
  },
  {
    sourceRef: 'DTL-037',
    sourceDate: '2026-09-18',
    sourceOwnerLabel: 'Mallikarjun',
    ownerKey: 'mallikarjun',
    title: 'Fit actual control panel components within the 600x450 area',
    description:
      'Control Panel Component Placement: Fit actual components within estimated 600x450 area using FreeCAD and Claude integ',
    sourceStatus: 'In Progress',
    workstreamKey: 'ele',
    milestoneKey: 'ele-panel-layout',
    truncated: true,
  },
  {
    sourceRef: 'DTL-038',
    sourceDate: '2026-09-18',
    sourceOwnerLabel: 'Ashutosh',
    ownerKey: 'ashutosh',
    title: 'Research site permissions for welding, cutting and safety screens',
    description:
      'Site Permissions & Safety: Research site permissions required for welding, cutting, and safety screens during installation',
    sourceStatus: 'In Progress',
    workstreamKey: 'dep',
  },

  // --- 21 Sep 2026 --------------------------------------------------------
  {
    sourceRef: 'DTL-039',
    sourceDate: '2026-09-21',
    sourceOwnerLabel: 'Rani',
    ownerKey: 'rani',
    title: 'Run the Isaac/manipulation stack on Gazebo and fix pick-and-place gaps',
    description:
      'Gazebo Simulation & Code Push: Run Isaac/manipulation stack on Gazebo, fix pick-and-place gaps from the first milestone, an',
    sourceStatus: 'Done',
    workstreamKey: 'sim',
    milestoneKey: 'sim-stack',
    truncated: true,
    decompositionNote:
      'Contains running the stack, fixing pick-and-place gaps, and a code push. Split if they ' +
      'need separate tracking.',
  },
  {
    sourceRef: 'DTL-040',
    sourceDate: '2026-09-21',
    sourceOwnerLabel: 'Rani',
    ownerKey: 'rani',
    title: 'Plan demo video scenarios and execution with Yash',
    description: 'Video Planning Call: Connect with Yash to plan scenarios and execution for the upcoming demo video',
    sourceStatus: 'Done',
    workstreamKey: 'doc',
    milestoneKey: 'doc-demo-video',
  },
  {
    sourceRef: 'DTL-041',
    sourceDate: '2026-09-21',
    sourceOwnerLabel: 'Faizan',
    ownerKey: 'faizan',
    title: 'Draft a comparison table between the Chinese arm and the FANUC arm',
    description:
      'Robotic Arm Comparison: Draft comparison table between Chinese arm and FANUC arm (payload capacity, unload test scena',
    sourceStatus: 'In Progress',
    workstreamKey: 'man',
    milestoneKey: 'man-arm-selection',
    deliverableKey: 'man-arm-table',
    truncated: true,
  },
  {
    sourceRef: 'DTL-042',
    sourceDate: '2026-09-21',
    sourceOwnerLabel: 'Faizan',
    ownerKey: 'faizan',
    title: 'Share the battery sizing model for different power configurations',
    description:
      'Battery Sizing Model: Share drafted Excel formulas/sheet for battery sizing under different power configurations (AC/DC vs. D',
    sourceStatus: 'In Progress',
    workstreamKey: 'ele',
    truncated: true,
  },
  {
    sourceRef: 'DTL-043',
    sourceDate: '2026-09-21',
    sourceOwnerLabel: 'Faizan',
    ownerKey: 'faizan',
    title: 'Swap the Chinese arm configuration into the Isaac simulation and test',
    description:
      'Isaac Simulation Testing: Swap in Chinese arm configuration in Isaac simulation and run testing prior to physical arm preparat',
    sourceStatus: 'In Progress',
    workstreamKey: 'sim',
    milestoneKey: 'sim-stack',
    truncated: true,
  },

  // --- 22 Sep 2026 --------------------------------------------------------
  {
    sourceRef: 'DTL-044',
    sourceDate: '2026-09-22',
    sourceOwnerLabel: 'Faizan',
    ownerKey: 'faizan',
    title: 'Get vendor confirmation of cobot load and moment testing',
    description:
      'Cobot Load & Moment Testing Verification: Get technical clarity and test confirmation from the vendor regarding 20 kg paylo',
    sourceStatus: 'In Progress',
    workstreamKey: 'man',
    milestoneKey: 'man-arm-selection',
    truncated: true,
  },
  {
    sourceRef: 'DTL-045',
    sourceDate: '2026-09-22',
    sourceOwnerLabel: 'Faizan',
    ownerKey: 'faizan',
    title: 'Reach out directly to the Chinese cobot manufacturer',
    description:
      'Direct Cobot Vendor Outreach: Reach out directly to the Chinese cobot manufacturing company to bypass intermediate sales',
    sourceStatus: 'In Progress',
    workstreamKey: 'prc',
    truncated: true,
  },
  {
    sourceRef: 'DTL-046',
    sourceDate: '2026-09-22',
    sourceOwnerLabel: 'Firaz',
    ownerKey: 'firaz',
    title: 'Explore FreeCAD and main conveyor coupling options into a sheet',
    description:
      'FreeCAD & Coupling Analysis: Explore FreeCAD and main conveyor coupling options, compile listed options into an Excel shee',
    sourceStatus: 'In Progress',
    workstreamKey: 'cnv',
    milestoneKey: 'cnv-coupling',
    deliverableKey: 'cnv-coupling-sheet',
    truncated: true,
  },

  // --- 23 Sep 2026 --------------------------------------------------------
  {
    sourceRef: 'DTL-047',
    sourceDate: '2026-09-23',
    sourceOwnerLabel: 'Rani',
    ownerKey: 'rani',
    title: 'Put up testing scenarios to fix stack issues and optimise arm speed',
    description:
      'Arm Speed Optimization & Testing Scenarios: Put up testing scenarios to fix stack issues and optimize robotic arm speed in pa',
    sourceStatus: 'In Progress',
    workstreamKey: 'man',
    truncated: true,
    decompositionNote:
      'Covers both fixing stack issues and optimising arm speed. Split if they need separate tracking.',
  },
  {
    sourceRef: 'DTL-048',
    sourceDate: '2026-09-23',
    sourceOwnerLabel: 'Rani',
    ownerKey: 'rani',
    title: 'Coordinate demo video design and animation changes',
    description: 'Demo Video & Animation Updates: Coordinate design and animation changes for the video.',
    sourceStatus: 'Transfer to Ashutosh',
    workstreamKey: 'doc',
    milestoneKey: 'doc-demo-video',
    transferNote:
      'The source records "Transfer to Ashutosh" in the timeline column. That is an ownership ' +
      'action, not a status, so it has not been treated as one. DTL-055 is the same task under ' +
      'Ashutosh. Confirm whether this record should be closed as transferred.',
    duplicateNote: 'Same task text as DTL-055, which is owned by Ashutosh and In Progress.',
  },
  {
    sourceRef: 'DTL-049',
    sourceDate: '2026-09-23',
    sourceOwnerLabel: 'Mallikarjun',
    ownerKey: 'mallikarjun',
    title: 'Ongoing project tasks',
    description:
      'Ongoing Project Tasks: Continue execution on assigned technical/design deliverables and sync alignment with the team',
    sourceStatus: 'In Progress',
    workstreamKey: 'mec',
    classificationUncertain:
      'A placeholder entry rather than a discrete task: it names no deliverable and no outcome. ' +
      'Placed under Mechanical Design only so it is not lost.',
    decompositionNote:
      'Not independently trackable as written. Replace with the actual deliverables it stands for.',
  },
  {
    sourceRef: 'DTL-050',
    sourceDate: '2026-09-23',
    sourceOwnerLabel: 'Firaz',
    ownerKey: 'firaz',
    title: 'Get conveyor pricing for the European region',
    description: 'Get the pricing for the conveyor for the European region.',
    sourceStatus: 'In Progress',
    workstreamKey: 'prc',
  },
  {
    sourceRef: 'DTL-051',
    sourceDate: '2026-09-23',
    sourceOwnerLabel: 'Firaz',
    ownerKey: 'firaz',
    title: 'Get pricing for the robot chassis assembly',
    description: 'Get the pricing for the robot chassis assembly.',
    sourceStatus: 'In Progress',
    workstreamKey: 'prc',
  },
  {
    sourceRef: 'DTL-052',
    sourceDate: '2026-09-23',
    sourceOwnerLabel: 'Firaz',
    ownerKey: 'firaz',
    title: 'Get details of locally available conveyor couplings',
    description: 'Get the details of locally available conveyor couplings.',
    sourceStatus: 'In Progress',
    workstreamKey: 'cnv',
    milestoneKey: 'cnv-coupling',
  },
  {
    sourceRef: 'DTL-053',
    sourceDate: '2026-09-23',
    sourceOwnerLabel: 'Firaz',
    ownerKey: 'firaz',
    title: 'Add the remaining test cases to the latch testing document',
    description: 'Add the remaining test cases to the latch testing document.',
    sourceStatus: 'In Progress',
    workstreamKey: 'tst',
    milestoneKey: 'tst-latch-doc',
    deliverableKey: 'tst-latch-document',
  },
  {
    sourceRef: 'DTL-054',
    sourceDate: '2026-09-23',
    sourceOwnerLabel: 'Firaz',
    ownerKey: 'firaz',
    title: 'Perform the latch simulation in SolidWorks',
    description: 'Perform the latch simulation in SolidWorks.',
    sourceStatus: 'In Progress',
    workstreamKey: 'sim',
    milestoneKey: 'sim-latch',
  },
  {
    sourceRef: 'DTL-055',
    sourceDate: '2026-09-23',
    sourceOwnerLabel: 'Ashutosh',
    ownerKey: 'ashutosh',
    title: 'Coordinate demo video design and animation changes',
    description: 'Demo Video & Animation Updates: Coordinate design and animation changes for the video.',
    sourceStatus: 'In Progress',
    workstreamKey: 'doc',
    milestoneKey: 'doc-demo-video',
    duplicateNote:
      'Same task text as DTL-048 (Rani), whose timeline reads "Transfer to Ashutosh". This ' +
      'record appears to be the continuation after that transfer.',
  },
  {
    sourceRef: 'DTL-056',
    sourceDate: '2026-09-23',
    sourceOwnerLabel: 'Ashutosh',
    ownerKey: 'ashutosh',
    title: 'Complete the end-to-end shipping process documentation',
    description:
      'End-to-End Shipping Documentation: Complete the end-to-end shipping process/issues documentation for team review and v',
    sourceStatus: 'In Progress',
    workstreamKey: 'doc',
    truncated: true,
    // The only review information the source establishes anywhere.
    reviewerKey: 'rani',
    progressNote: '70–80% Done',
    reviewNote: 'Reviewed by Rani; 1 final area remains to be explored before the validation',
  },
];

export const AUTODOCK_DATA: AutoDockDataset = {
  label: 'AUTODOCK — imported from the team daily task log',
  sourceDocument: 'Daily task.pdf (daily task log, 10–23 Sep 2026, 56 rows)',
  project: {
    code: 'AD',
    name: 'AutoDock',
    description:
      'AutoDock robotics programme. Structure and tasks imported from the team daily task log.',
    leadKey: 'rani',
  },
  users: USERS,
  workstreams: WORKSTREAMS,
  tasks: TASKS,
};
