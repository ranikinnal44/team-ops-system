/**
 * Dataset registry.
 *
 * Demo and real project data are kept strictly apart: each is a named dataset,
 * only one is ever loaded into a database, and the choice is explicit. Demo
 * users and demo tasks can therefore never end up mixed into real project data.
 */
import type { Database } from '../db/connection.ts';
import { seedDemo } from './demo-loader.ts';
import { importAutoDock, type ImportReport } from './autodock-loader.ts';
import { DEMO_DATA } from './demo-data.ts';
import { AUTODOCK_DATA } from './autodock-data.ts';
import { BUILD_TIMELINE } from './build-timeline-data.ts';

export const DatasetName = {
  Demo: 'DEMO',
  /** The live project: the Stream 1 build plan. */
  AutoDock: 'AUTO_DOCK',
  /** The same project with the historical daily task log loaded alongside it. */
  AutoDockWithLog: 'AUTO_DOCK_WITH_LOG',
} as const;
export type DatasetName = (typeof DatasetName)[keyof typeof DatasetName];

export const DATASET_NAMES = Object.values(DatasetName) as readonly DatasetName[];

export type DatasetDefinition = {
  readonly name: DatasetName;
  readonly label: string;
  readonly description: string;
  /** Loads the dataset and returns an import report where one applies. */
  readonly load: (db: Database) => ImportReport | null;
};

export const DATASETS: Record<DatasetName, DatasetDefinition> = {
  [DatasetName.Demo]: {
    name: DatasetName.Demo,
    label: DEMO_DATA.label,
    description:
      'Synthetic team and tasks. Exercises every status, exception and deadline path; used for ' +
      'development and tests.',
    load: (db) => {
      seedDemo(db);
      return null;
    },
  },
  [DatasetName.AutoDock]: {
    name: DatasetName.AutoDock,
    label: 'AUTODOCK — Stream 1 build plan',
    description:
      `The live project: ${BUILD_TIMELINE.sourceDocument}. ` +
      'Tasks are the Stream 1 plan only.',
    load: (db) => importAutoDock(db, AUTODOCK_DATA, { includeDailyLog: false }),
  },
  [DatasetName.AutoDockWithLog]: {
    name: DatasetName.AutoDockWithLog,
    label: 'AUTODOCK — Stream 1 build plan plus the historical daily task log',
    description:
      'The Stream 1 plan with the 56 daily-log rows loaded alongside it, for looking back at ' +
      'what was worked on in September.',
    load: (db) => importAutoDock(db, AUTODOCK_DATA, { includeDailyLog: true }),
  },
};

export const isDatasetName = (value: string): value is DatasetName =>
  (DATASET_NAMES as readonly string[]).includes(value);

/** Default for a real deployment; tests and `npm run seed:demo` ask for DEMO. */
export const DEFAULT_DATASET: DatasetName = DatasetName.AutoDock;
