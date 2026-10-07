/**
 * Supply register read model and updates.
 *
 * Reading is open to everyone — the whole team benefits from knowing an
 * eight-week item is about to become the critical path. Changing an order's
 * state is manager-only, like every other commitment in the system.
 */
import type { Database } from '../db/connection.ts';
import * as supplyRepo from '../repositories/supply.repo.ts';
import * as userRepo from '../repositories/user.repo.ts';
import type { SupplyItem } from '../repositories/supply.repo.ts';
import type { Actor } from '../domain/types.ts';
import {
  SupplyKind,
  SupplyStatus,
  SupplyFlag,
  SUPPLY_FLAG_LABEL,
  evaluateSupplyItem,
  supplyUrgency,
  daysUntilOrderBy,
  expectedArrival,
  slackDays,
  DEFAULT_ORDER_WARNING_DAYS,
} from '../domain/supply.ts';
import { Capability, assertCan } from '../domain/permissions.ts';
import { notFound, validationError } from '../lib/errors.ts';
import { todayDate, addDays, type IsoDate } from '../lib/dates.ts';

export type SupplyView = SupplyItem & {
  readonly flag: SupplyFlag | null;
  readonly flagLabel: string | null;
  readonly daysUntilOrderBy: number | null;
  readonly expectedArrival: IsoDate | null;
  readonly slackDays: number | null;
  readonly urgency: number;
};

function toView(item: SupplyItem, today: IsoDate): SupplyView {
  const flag = evaluateSupplyItem(item, today);
  return {
    ...item,
    flag,
    flagLabel: flag === null ? null : SUPPLY_FLAG_LABEL[flag],
    daysUntilOrderBy: daysUntilOrderBy(item, today),
    expectedArrival: expectedArrival(item),
    slackDays: slackDays(item),
    urgency: supplyUrgency(item, today),
  };
}

export type SupplyRegister = {
  generatedFor: IsoDate;
  warningDays: number;
  /** Orders, most urgent first. */
  orders: SupplyView[];
  /** Constraints with nothing to place an order for. */
  risks: SupplyView[];
  summary: {
    total: number;
    notOrdered: number;
    ordered: number;
    received: number;
    orderLate: number;
    orderDue: number;
    arrivesLate: number;
  };
  /** The single item that needs acting on soonest, if any. */
  mostUrgent: SupplyView | null;
};

export function supplyRegister(db: Database, now = new Date()): SupplyRegister {
  const today = todayDate(now);
  const all = supplyRepo.listSupplyItems(db).map((item) => toView(item, today));
  const orders = all
    .filter((i) => i.kind === SupplyKind.Order)
    .sort((a, b) => b.urgency - a.urgency || (a.orderByDate ?? '').localeCompare(b.orderByDate ?? ''));
  const risks = all.filter((i) => i.kind === SupplyKind.Risk);
  const count = (flag: SupplyFlag): number => orders.filter((i) => i.flag === flag).length;

  return {
    generatedFor: today,
    warningDays: DEFAULT_ORDER_WARNING_DAYS,
    orders,
    risks,
    summary: {
      total: orders.length,
      notOrdered: orders.filter((i) => i.status === SupplyStatus.NotOrdered).length,
      ordered: orders.filter((i) => i.status === SupplyStatus.Ordered).length,
      received: orders.filter((i) => i.status === SupplyStatus.Received).length,
      orderLate: count(SupplyFlag.OrderLate),
      orderDue: count(SupplyFlag.OrderDue),
      arrivesLate: count(SupplyFlag.ArrivesLate),
    },
    mostUrgent: orders.find((i) => i.flag !== null && i.flag !== SupplyFlag.Awaiting) ?? null,
  };
}

export type NewSupplyInput = {
  milestoneId: string;
  label: string;
  kind: SupplyKind;
  leadTimeWeeks?: number | null;
  orderByDate?: IsoDate | null;
  neededByDate?: IsoDate | null;
  critical?: boolean;
  note?: string | null;
};

export function createSupplyItem(
  db: Database,
  actor: Actor,
  input: NewSupplyInput,
  now = new Date(),
): SupplyView {
  assertCan(actor.role, Capability.ManageSupply);
  if (input.kind === SupplyKind.Order && !input.leadTimeWeeks && !input.orderByDate) {
    throw validationError('An order needs a lead time or an order-by date', [
      { path: 'leadTimeWeeks', message: 'give a lead time, an order-by date, or both' },
    ]);
  }
  // With a lead time and a needed-by date but no order date, work it back.
  const orderByDate =
    input.orderByDate ??
    (input.leadTimeWeeks && input.neededByDate
      ? addDays(input.neededByDate, -input.leadTimeWeeks * 7)
      : null);

  const id = supplyRepo.insertSupplyItem(db, {
    milestoneId: input.milestoneId,
    label: input.label,
    kind: input.kind,
    leadTimeWeeks: input.leadTimeWeeks ?? null,
    orderByDate,
    orderByDerived: input.orderByDate === undefined || input.orderByDate === null,
    neededByDate: input.neededByDate ?? null,
    critical: input.critical ?? false,
    note: input.note ?? null,
  });
  const created = supplyRepo.findSupplyItem(db, id);
  if (!created) throw notFound('Supply item');
  return toView(created, todayDate(now));
}

export function deleteSupplyItem(db: Database, actor: Actor, id: string): void {
  assertCan(actor.role, Capability.ManageSupply);
  if (!supplyRepo.findSupplyItem(db, id)) throw notFound('Supply item');
  supplyRepo.deleteSupplyItem(db, id);
}

export type SupplyUpdate = {
  status?: SupplyStatus;
  orderedOn?: IsoDate | null;
  receivedOn?: IsoDate | null;
  ownerId?: string | null;
  note?: string | null;
  orderByDate?: IsoDate | null;
  neededByDate?: IsoDate | null;
};

export function updateSupplyItem(
  db: Database,
  actor: Actor,
  id: string,
  input: SupplyUpdate,
  now = new Date(),
): SupplyView {
  assertCan(actor.role, Capability.ManageSupply);
  const existing = supplyRepo.findSupplyItem(db, id);
  if (!existing) throw notFound('Supply item');
  if (existing.kind !== SupplyKind.Order && input.status !== undefined) {
    throw validationError('This entry is a constraint, not an order', [
      { path: 'status', message: 'only orders carry an order status' },
    ]);
  }
  if (input.ownerId) {
    const owner = userRepo.findUserById(db, input.ownerId);
    if (!owner) throw validationError('Unknown owner', [{ path: 'ownerId', message: 'not a known user' }]);
  }

  const patch: supplyRepo.SupplyPatch = { ...input };
  // Marking it ordered or received without naming a date means today.
  if (input.status === SupplyStatus.Ordered && input.orderedOn === undefined && !existing.orderedOn) {
    patch.orderedOn = todayDate(now);
  }
  if (input.status === SupplyStatus.Received && input.receivedOn === undefined && !existing.receivedOn) {
    patch.receivedOn = todayDate(now);
    if (!existing.orderedOn && input.orderedOn === undefined) patch.orderedOn = todayDate(now);
  }

  supplyRepo.updateSupplyItem(db, id, patch);
  const updated = supplyRepo.findSupplyItem(db, id);
  if (!updated) throw notFound('Supply item');
  return toView(updated, todayDate(now));
}
