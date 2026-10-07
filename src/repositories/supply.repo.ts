/**
 * The supply register: long-lead orders and the constraints around them.
 */
import type { Database } from '../db/connection.ts';
import { toBool, fromBool, toText } from '../db/connection.ts';
import type { SupplyKind, SupplyStatus } from '../domain/supply.ts';
import { newId } from '../lib/ids.ts';
import { nowTimestamp, type IsoDate, type IsoTimestamp } from '../lib/dates.ts';

export type SupplyItem = {
  readonly id: string;
  readonly milestoneId: string;
  readonly milestoneName: string;
  readonly workstreamCode: string;
  readonly label: string;
  readonly kind: SupplyKind;
  readonly leadTimeWeeks: number | null;
  readonly orderByDate: IsoDate | null;
  readonly orderByDerived: boolean;
  readonly neededByDate: IsoDate | null;
  readonly neededByMilestoneName: string | null;
  readonly status: SupplyStatus;
  readonly orderedOn: IsoDate | null;
  readonly receivedOn: IsoDate | null;
  readonly ownerId: string | null;
  readonly ownerName: string | null;
  readonly critical: boolean;
  readonly note: string | null;
  readonly sourceText: string | null;
  readonly sourceRef: string | null;
  readonly createdAt: IsoTimestamp;
  readonly lastUpdatedAt: IsoTimestamp;
};

type Row = Record<string, unknown>;

const SELECT = `
  SELECT s.*,
         m.name AS milestone_name,
         w.code AS workstream_code,
         nm.name AS needed_by_milestone_name,
         u.name AS owner_name
  FROM supply_items s
  JOIN milestones  m ON m.id = s.milestone_id
  JOIN workstreams w ON w.id = m.workstream_id
  LEFT JOIN milestones nm ON nm.id = s.needed_by_milestone_id
  LEFT JOIN users u ON u.id = s.owner_id`;

const map = (row: Row): SupplyItem => ({
  id: row.id as string,
  milestoneId: row.milestone_id as string,
  milestoneName: row.milestone_name as string,
  workstreamCode: row.workstream_code as string,
  label: row.label as string,
  kind: row.kind as SupplyKind,
  leadTimeWeeks: row.lead_time_weeks === null ? null : (row.lead_time_weeks as number),
  orderByDate: toText(row.order_by_date),
  orderByDerived: toBool(row.order_by_derived),
  neededByDate: toText(row.needed_by_date),
  neededByMilestoneName: toText(row.needed_by_milestone_name),
  status: row.status as SupplyStatus,
  orderedOn: toText(row.ordered_on),
  receivedOn: toText(row.received_on),
  ownerId: toText(row.owner_id),
  ownerName: toText(row.owner_name),
  critical: toBool(row.critical),
  note: toText(row.note),
  sourceText: toText(row.source_text),
  sourceRef: toText(row.source_ref),
  createdAt: row.created_at as string,
  lastUpdatedAt: row.last_updated_at as string,
});

export type NewSupplyItem = {
  milestoneId: string;
  label: string;
  kind: SupplyKind;
  leadTimeWeeks?: number | null;
  orderByDate?: IsoDate | null;
  orderByDerived?: boolean;
  neededByDate?: IsoDate | null;
  neededByMilestoneId?: string | null;
  critical?: boolean;
  note?: string | null;
  sourceText?: string | null;
  sourceRef?: string | null;
};

export function insertSupplyItem(db: Database, input: NewSupplyItem): string {
  const id = newId();
  const now = nowTimestamp();
  db.prepare(
    `INSERT INTO supply_items
       (id, milestone_id, label, kind, lead_time_weeks, order_by_date, order_by_derived,
        needed_by_date, needed_by_milestone_id, status, critical, note, source_text, source_ref,
        created_at, last_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_ordered', ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.milestoneId,
    input.label,
    input.kind,
    input.leadTimeWeeks ?? null,
    input.orderByDate ?? null,
    fromBool(input.orderByDerived ?? false),
    input.neededByDate ?? null,
    input.neededByMilestoneId ?? null,
    fromBool(input.critical ?? false),
    input.note ?? null,
    input.sourceText ?? null,
    input.sourceRef ?? null,
    now,
    now,
  );
  return id;
}

export function listSupplyItems(db: Database, opts: { kind?: SupplyKind } = {}): SupplyItem[] {
  const rows = (
    opts.kind
      ? db.prepare(`${SELECT} WHERE s.kind = ? ORDER BY s.order_by_date, s.label`).all(opts.kind)
      : db.prepare(`${SELECT} ORDER BY s.kind, s.order_by_date, s.label`).all()
  ) as Row[];
  return rows.map(map);
}

export function findSupplyItem(db: Database, id: string): SupplyItem | null {
  const row = db.prepare(`${SELECT} WHERE s.id = ?`).get(id) as Row | undefined;
  return row ? map(row) : null;
}

export type SupplyPatch = {
  status?: SupplyStatus;
  orderedOn?: IsoDate | null;
  receivedOn?: IsoDate | null;
  ownerId?: string | null;
  note?: string | null;
  orderByDate?: IsoDate | null;
  neededByDate?: IsoDate | null;
};

const COLUMN: Record<keyof SupplyPatch, string> = {
  status: 'status',
  orderedOn: 'ordered_on',
  receivedOn: 'received_on',
  ownerId: 'owner_id',
  note: 'note',
  orderByDate: 'order_by_date',
  neededByDate: 'needed_by_date',
};

export function updateSupplyItem(db: Database, id: string, patch: SupplyPatch): void {
  const entries = Object.entries(patch) as [keyof SupplyPatch, unknown][];
  if (entries.length === 0) return;
  const assignments = entries.map(([field]) => `${COLUMN[field]} = ?`);
  assignments.push('last_updated_at = ?');
  db.prepare(`UPDATE supply_items SET ${assignments.join(', ')} WHERE id = ?`).run(
    ...entries.map(([, value]) => value as string | number | null),
    nowTimestamp(),
    id,
  );
}

export function deleteSupplyItem(db: Database, id: string): void {
  db.prepare('DELETE FROM supply_items WHERE id = ?').run(id);
}
