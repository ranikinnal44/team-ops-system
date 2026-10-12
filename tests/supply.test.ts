/**
 * Supply register — the long-lead rules and the register built from the plan.
 *
 * These are the rules that decide whether an eight-week order is still
 * recoverable, so most of them pin down boundaries rather than happy paths.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import type { Database } from '../src/db/connection.ts';
import { autoDockDb, actorByEmail } from './helpers.ts';
import { createWeekResolver } from '../src/lib/weeks.ts';
import { config } from '../src/config/index.ts';

// The same resolver the import uses. Hard-coding dates here would tie the
// suite to the week it was written in — `AUTODOCK_W1_START` defaults to today
// when .env is not loaded, which `npm test` does not do.
const weeks = createWeekResolver(config.weekAnchor);
import * as supplyRepo from '../src/repositories/supply.repo.ts';
import { supplyRegister, updateSupplyItem } from '../src/services/supply.service.ts';
import {
  SupplyKind,
  SupplyStatus,
  SupplyFlag,
  evaluateSupplyItem,
  daysUntilOrderBy,
  expectedArrival,
  slackDays,
  type EvaluableSupplyItem,
} from '../src/domain/supply.ts';
import { AppError, ErrorCode } from '../src/lib/errors.ts';

const TODAY = '2026-10-07';

const order = (overrides: Partial<EvaluableSupplyItem> = {}): EvaluableSupplyItem => ({
  kind: SupplyKind.Order,
  status: SupplyStatus.NotOrdered,
  leadTimeWeeks: 8,
  orderByDate: '2026-10-16',
  neededByDate: '2026-12-11',
  orderedOn: null,
  ...overrides,
});

describe('order timing', () => {
  test('counts the days left to place an order', () => {
    assert.equal(daysUntilOrderBy(order(), TODAY), 9);
    assert.equal(daysUntilOrderBy(order({ orderByDate: TODAY }), TODAY), 0);
    assert.equal(daysUntilOrderBy(order({ orderByDate: '2026-10-01' }), TODAY), -6);
  });

  test('arrival is lead time from the order date, actual if known', () => {
    assert.equal(expectedArrival(order()), '2026-12-11');
    assert.equal(expectedArrival(order({ orderedOn: '2026-10-20' })), '2026-12-15');
  });

  test('arrival is unknown without a lead time or a date to count from', () => {
    assert.equal(expectedArrival(order({ leadTimeWeeks: null })), null);
    assert.equal(expectedArrival(order({ orderByDate: null })), null);
  });

  test('slack is the gap between arrival and when it is needed', () => {
    assert.equal(slackDays(order()), 0, 'ordered on time it arrives the day it is needed');
    assert.equal(slackDays(order({ orderedOn: '2026-10-19' })), -3, 'three days late to order');
    assert.equal(slackDays(order({ neededByDate: null })), null);
  });
});

describe('what the register says about an order', () => {
  test('nothing, while the order date is far off', () => {
    assert.equal(evaluateSupplyItem(order({ orderByDate: '2026-12-01' }), TODAY), null);
  });

  test('order due, inside the warning window', () => {
    assert.equal(evaluateSupplyItem(order(), TODAY), SupplyFlag.OrderDue);
  });

  test('order late, once the date has passed', () => {
    assert.equal(
      evaluateSupplyItem(order({ orderByDate: '2026-10-01' }), TODAY),
      SupplyFlag.OrderLate,
    );
  });

  test('once ordered on time it is simply awaited', () => {
    assert.equal(
      evaluateSupplyItem(order({ status: SupplyStatus.Ordered, orderedOn: '2026-10-16' }), TODAY),
      SupplyFlag.Awaiting,
    );
  });

  test('ordered late reads as arriving late, not as awaiting', () => {
    assert.equal(
      evaluateSupplyItem(order({ status: SupplyStatus.Ordered, orderedOn: '2026-10-30' }), TODAY),
      SupplyFlag.ArrivesLate,
    );
  });

  test('received and not-needed items drop out entirely', () => {
    assert.equal(evaluateSupplyItem(order({ status: SupplyStatus.Received }), TODAY), null);
    assert.equal(evaluateSupplyItem(order({ status: SupplyStatus.NotNeeded }), TODAY), null);
  });

  test('a constraint with nothing to order is never flagged', () => {
    assert.equal(evaluateSupplyItem(order({ kind: SupplyKind.Risk }), TODAY), null);
  });

  test('an order with no order-by date cannot be judged', () => {
    assert.equal(evaluateSupplyItem(order({ orderByDate: null }), TODAY), null);
  });
});

describe('the register built from the build timeline', () => {
  let db: Database;
  before(() => {
    db = autoDockDb();
  });

  test('separates the four real orders from the six constraints', () => {
    const items = supplyRepo.listSupplyItems(db);
    assert.equal(items.length, 10);
    assert.equal(items.filter((i) => i.kind === SupplyKind.Order).length, 4);
    assert.equal(items.filter((i) => i.kind === SupplyKind.Risk).length, 6);
  });

  test('constraints carry no invented dates', () => {
    for (const risk of supplyRepo.listSupplyItems(db, { kind: SupplyKind.Risk })) {
      assert.equal(risk.orderByDate, null);
      assert.equal(risk.leadTimeWeeks, null);
      assert.equal(risk.neededByDate, null);
    }
  });

  test('every entry keeps the wording it came from', () => {
    for (const item of supplyRepo.listSupplyItems(db)) {
      assert.ok(item.sourceText && item.sourceText.length > 0);
    }
  });

  test("the plan's own order dates are used, not worked backwards", () => {
    const register = supplyRegister(db);
    const vfd = register.orders.find((o) => o.label === 'VFD');
    const pneumatic = register.orders.find((o) => o.label === 'Pneumatic system');
    assert.ok(vfd && pneumatic);
    assert.equal(vfd.orderByDate, weeks.endOf(1), 'stated as "VFD order release by W1 end"');
    assert.equal(pneumatic.orderByDate, weeks.endOf(2), 'stated as "by W2"');
    assert.ok(!vfd.orderByDerived && !pneumatic.orderByDerived);
  });

  test('dates worked backwards are marked as derived', () => {
    const register = supplyRegister(db);
    const mech = register.orders.find((o) => o.label === 'Mechanical parts');
    assert.ok(mech);
    assert.ok(mech.orderByDerived, 'the plan states a lead time but no order date');
    assert.equal(mech.leadTimeWeeks, 2);
  });

  test('the pneumatic system has no spare time at all', () => {
    const register = supplyRegister(db);
    const pneumatic = register.orders.find((o) => o.label === 'Pneumatic system');
    assert.ok(pneumatic);
    assert.equal(pneumatic.slackDays, 0, 'ordered on time it arrives the day it is needed');
    assert.equal(pneumatic.neededByDate, weeks.endOf(10), 'the end of the milestone that consumes it');
    assert.ok(pneumatic.critical);
  });

  test('the VFD has no needed-by date, so its arrival cannot be judged', () => {
    const register = supplyRegister(db);
    const vfd = register.orders.find((o) => o.label === 'VFD');
    assert.ok(vfd);
    assert.equal(vfd.neededByDate, null, 'the plan never says which milestone consumes it');
    assert.equal(vfd.slackDays, null);
    assert.match(vfd.note ?? '', /Confirm when it has to be on site/);
  });

  test('orders sort by what will hurt soonest', () => {
    const register = supplyRegister(db);
    for (let i = 1; i < register.orders.length; i += 1) {
      assert.ok((register.orders[i - 1]?.urgency ?? 0) >= (register.orders[i]?.urgency ?? 0));
    }
  });

  test('the most urgent item skips anything merely awaited', () => {
    const register = supplyRegister(db);
    assert.ok(register.mostUrgent);
    assert.notEqual(register.mostUrgent.flag, SupplyFlag.Awaiting);
  });
});

describe('updating an order', () => {
  let db: Database;
  before(() => {
    db = autoDockDb();
  });

  test('marking it ordered records the date and stops the countdown', () => {
    const manager = actorByEmail(db, 'rani@example.com');
    const target = supplyRepo.listSupplyItems(db, { kind: SupplyKind.Order })[0];
    assert.ok(target);

    const updated = updateSupplyItem(db, manager, target.id, { status: SupplyStatus.Ordered });
    assert.equal(updated.status, SupplyStatus.Ordered);
    assert.ok(updated.orderedOn, 'the date it was ordered is what the arrival is counted from');
    assert.notEqual(updated.flag, SupplyFlag.OrderDue);
  });

  test('an employee cannot change an order', () => {
    const employee = actorByEmail(db, 'firaz@example.com');
    const target = supplyRepo.listSupplyItems(db, { kind: SupplyKind.Order })[0];
    assert.ok(target);
    assert.throws(
      () => updateSupplyItem(db, employee, target.id, { status: SupplyStatus.Received }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.FORBIDDEN,
    );
  });

  test('a constraint has no order status to set', () => {
    const manager = actorByEmail(db, 'rani@example.com');
    const risk = supplyRepo.listSupplyItems(db, { kind: SupplyKind.Risk })[0];
    assert.ok(risk);
    assert.throws(
      () => updateSupplyItem(db, manager, risk.id, { status: SupplyStatus.Ordered }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.VALIDATION,
    );
  });

  test('an unknown item is a 404, not a silent no-op', () => {
    const manager = actorByEmail(db, 'rani@example.com');
    assert.throws(
      () => updateSupplyItem(db, manager, 'nope', { status: SupplyStatus.Ordered }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.NOT_FOUND,
    );
  });
});
