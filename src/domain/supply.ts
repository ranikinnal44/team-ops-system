/**
 * Long-lead supply rules.
 *
 * Pure functions, like the task exception rules, so a dashboard today and an
 * automation job later evaluate exactly the same logic.
 *
 * The question these answer is not "is this late" but "is it still possible":
 * an eight-week item ordered one day late arrives one day late, and no amount
 * of effort downstream recovers it.
 */
import { daysBetween, addDays, todayDate, type IsoDate } from '../lib/dates.ts';

export const SupplyKind = { Order: 'order', Risk: 'risk' } as const;
export type SupplyKind = (typeof SupplyKind)[keyof typeof SupplyKind];

export const SupplyStatus = {
  NotOrdered: 'not_ordered',
  Ordered: 'ordered',
  Received: 'received',
  NotNeeded: 'not_needed',
} as const;
export type SupplyStatus = (typeof SupplyStatus)[keyof typeof SupplyStatus];

export const SUPPLY_STATUS_LABEL: Record<SupplyStatus, string> = {
  not_ordered: 'Not ordered',
  ordered: 'Ordered',
  received: 'Received',
  not_needed: 'Not needed',
};

/** What the register says about one item, most urgent first. */
export const SupplyFlag = {
  /** The order-by date has passed and nothing has been ordered. */
  OrderLate: 'ORDER_LATE',
  /** It is ordered, but will arrive after it is needed. */
  ArrivesLate: 'ARRIVES_LATE',
  /** The order-by date is within the warning window. */
  OrderDue: 'ORDER_DUE',
  /** Ordered, on track, waiting. */
  Awaiting: 'AWAITING',
} as const;
export type SupplyFlag = (typeof SupplyFlag)[keyof typeof SupplyFlag];

export const SUPPLY_FLAG_LABEL: Record<SupplyFlag, string> = {
  ORDER_LATE: 'Order overdue',
  ARRIVES_LATE: 'Arrives too late',
  ORDER_DUE: 'Order due',
  AWAITING: 'Awaiting delivery',
};

export type EvaluableSupplyItem = {
  readonly kind: SupplyKind;
  readonly status: SupplyStatus;
  readonly leadTimeWeeks: number | null;
  readonly orderByDate: IsoDate | null;
  readonly neededByDate: IsoDate | null;
  readonly orderedOn: IsoDate | null;
};

/** Default warning window: start shouting a fortnight before the order is due. */
export const DEFAULT_ORDER_WARNING_DAYS = 14;

const isOpen = (item: EvaluableSupplyItem): boolean =>
  item.kind === SupplyKind.Order &&
  item.status !== SupplyStatus.Received &&
  item.status !== SupplyStatus.NotNeeded;

/** Days until the order has to be placed. Negative means it is already late. */
export function daysUntilOrderBy(
  item: EvaluableSupplyItem,
  today: IsoDate = todayDate(),
): number | null {
  if (item.orderByDate === null) return null;
  return daysBetween(today, item.orderByDate);
}

/**
 * When it should turn up: from the day it was actually ordered if it has been,
 * otherwise from the day it is due to be ordered.
 */
export function expectedArrival(item: EvaluableSupplyItem): IsoDate | null {
  if (item.leadTimeWeeks === null) return null;
  const from = item.orderedOn ?? item.orderByDate;
  if (from === null) return null;
  return addDays(from, item.leadTimeWeeks * 7);
}

/**
 * Spare days between when it should arrive and when it is needed. Negative
 * means the schedule does not work even if everything goes to plan.
 */
export function slackDays(item: EvaluableSupplyItem): number | null {
  const arrival = expectedArrival(item);
  if (arrival === null || item.neededByDate === null) return null;
  return daysBetween(arrival, item.neededByDate);
}

export function evaluateSupplyItem(
  item: EvaluableSupplyItem,
  today: IsoDate = todayDate(),
  warningDays: number = DEFAULT_ORDER_WARNING_DAYS,
): SupplyFlag | null {
  if (!isOpen(item)) return null;

  const slack = slackDays(item);
  if (item.status === SupplyStatus.Ordered) {
    return slack !== null && slack < 0 ? SupplyFlag.ArrivesLate : SupplyFlag.Awaiting;
  }

  const until = daysUntilOrderBy(item, today);
  if (until === null) return null;
  if (until < 0) return SupplyFlag.OrderLate;
  if (until <= warningDays) return SupplyFlag.OrderDue;
  return null;
}

/** Highest first, so a register sorts by what will hurt soonest. */
export function supplyUrgency(
  item: EvaluableSupplyItem,
  today: IsoDate = todayDate(),
  warningDays: number = DEFAULT_ORDER_WARNING_DAYS,
): number {
  const flag = evaluateSupplyItem(item, today, warningDays);
  if (flag === null) return 0;
  const base = { ORDER_LATE: 400, ARRIVES_LATE: 300, ORDER_DUE: 200, AWAITING: 50 }[flag];
  const until = daysUntilOrderBy(item, today);
  // The nearer the deadline, the louder, within the same band.
  const proximity = until === null ? 0 : Math.max(0, 60 - Math.abs(until));
  const slack = slackDays(item);
  const tightness = slack === null ? 0 : Math.max(0, 30 - Math.max(0, slack));
  return base + proximity + tightness;
}
