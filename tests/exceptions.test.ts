import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TaskStatus, ExceptionFlag } from '../src/domain/enums.ts';
import {
  isOverdue,
  isDueSoon,
  hasNoRecentUpdate,
  isBlocked,
  isDueToday,
  evaluateTask,
  attentionScore,
  DEFAULT_THRESHOLDS,
  type EvaluableTask,
} from '../src/domain/exceptions.ts';

const TODAY = '2026-10-06'; // a Tuesday

/** `updatedDate` is a local calendar date; the rules read its date part. */
const task = (
  overrides: Partial<EvaluableTask> & { updatedDate?: string } = {},
): EvaluableTask => {
  const { updatedDate = TODAY, ...rest } = overrides;
  const [y, m, d] = updatedDate.split('-').map(Number) as [number, number, number];
  return {
    status: TaskStatus.InProgress,
    dueDate: '2026-10-10',
    lastUpdatedAt: new Date(y, m - 1, d, 12, 0).toISOString(),
    ...rest,
  };
};

describe('OVERDUE — due date < today AND status != completed', () => {
  test('flags a past due date', () => {
    assert.ok(isOverdue(task({ dueDate: '2026-10-05' }), TODAY));
  });

  test('does not flag a task due today', () => {
    assert.ok(!isOverdue(task({ dueDate: TODAY }), TODAY));
  });

  test('does not flag a future due date', () => {
    assert.ok(!isOverdue(task({ dueDate: '2026-10-07' }), TODAY));
  });

  test('never flags completed work, however late', () => {
    assert.ok(!isOverdue(task({ dueDate: '2026-01-01', status: TaskStatus.Completed }), TODAY));
  });
});

describe('DUE SOON — due within the threshold AND status != completed', () => {
  test('includes today and the next two days', () => {
    assert.ok(isDueSoon(task({ dueDate: TODAY }), TODAY));
    assert.ok(isDueSoon(task({ dueDate: '2026-10-07' }), TODAY));
    assert.ok(isDueSoon(task({ dueDate: '2026-10-08' }), TODAY));
  });

  test('excludes the third day out', () => {
    assert.ok(!isDueSoon(task({ dueDate: '2026-10-09' }), TODAY));
  });

  test('ignores completed work', () => {
    assert.ok(!isDueSoon(task({ dueDate: TODAY, status: TaskStatus.Completed }), TODAY));
  });

  test('honours a custom threshold', () => {
    const thresholds = { ...DEFAULT_THRESHOLDS, dueSoonDays: 5 };
    assert.ok(isDueSoon(task({ dueDate: '2026-10-11' }), TODAY, thresholds));
  });
});

describe('NO RECENT UPDATE — more than two working days since the last update', () => {
  test('two working days is not yet stale', () => {
    // Updated Friday 2026-10-02, checked Tuesday 2026-10-06 -> Mon, Tue = 2.
    assert.ok(!hasNoRecentUpdate(task({ updatedDate: '2026-10-02' }), TODAY));
  });

  test('three working days is stale', () => {
    // Updated Thursday 2026-10-01 -> Fri, Mon, Tue = 3.
    assert.ok(hasNoRecentUpdate(task({ updatedDate: '2026-10-01' }), TODAY));
  });

  test('a weekend does not age a task', () => {
    // Updated Friday, checked Monday -> 1 working day.
    assert.ok(!hasNoRecentUpdate(task({ updatedDate: '2026-10-02' }), '2026-10-05'));
  });

  test('updated today is never stale', () => {
    assert.ok(!hasNoRecentUpdate(task({ updatedDate: TODAY }), TODAY));
  });

  test('ignores completed work', () => {
    assert.ok(
      !hasNoRecentUpdate(task({ updatedDate: '2026-09-01', status: TaskStatus.Completed }), TODAY),
    );
  });
});

describe('BLOCKED', () => {
  test('is purely a function of status', () => {
    assert.ok(isBlocked(task({ status: TaskStatus.Blocked })));
    assert.ok(!isBlocked(task({ status: TaskStatus.InProgress })));
  });
});

describe('evaluateTask', () => {
  test('reports OVERDUE instead of DUE SOON, never both', () => {
    const flags = evaluateTask(task({ dueDate: '2026-10-04' }), TODAY);
    assert.ok(flags.includes(ExceptionFlag.Overdue));
    assert.ok(!flags.includes(ExceptionFlag.DueSoon));
  });

  test('combines BLOCKED with a deadline flag', () => {
    const flags = evaluateTask(
      task({ dueDate: '2026-10-04', status: TaskStatus.Blocked }),
      TODAY,
    );
    assert.deepEqual(flags.sort(), [ExceptionFlag.Blocked, ExceptionFlag.Overdue].sort());
  });

  test('stacks stale updates onto a deadline flag', () => {
    const flags = evaluateTask(
      task({ dueDate: '2026-10-07', updatedDate: '2026-09-28' }),
      TODAY,
    );
    assert.ok(flags.includes(ExceptionFlag.DueSoon));
    assert.ok(flags.includes(ExceptionFlag.NoRecentUpdate));
  });

  test('a healthy task has no flags', () => {
    assert.deepEqual(evaluateTask(task({ dueDate: '2026-10-20' }), TODAY), []);
  });

  test('a completed task has no flags at all', () => {
    assert.deepEqual(
      evaluateTask(
        task({ dueDate: '2026-01-01', status: TaskStatus.Completed, updatedDate: '2026-01-01' }),
        TODAY,
      ),
      [],
    );
  });

  test('isDueToday only matches the exact date on open work', () => {
    assert.ok(isDueToday(task({ dueDate: TODAY }), TODAY));
    assert.ok(!isDueToday(task({ dueDate: TODAY, status: TaskStatus.Completed }), TODAY));
  });
});

describe('attention score', () => {
  const scored = (overrides: Parameters<typeof task>[0] & { priority: 'P0' | 'P1' | 'P2' | 'P3' }) => {
    const { priority, ...rest } = overrides;
    return attentionScore({ ...task(rest), priority }, TODAY);
  };

  test('overdue outranks merely urgent', () => {
    const overdueLowPriority = scored({ priority: 'P3', dueDate: '2026-10-01' });
    const criticalButFuture = scored({ priority: 'P0', dueDate: '2026-10-20' });
    assert.ok(overdueLowPriority > criticalButFuture);
  });

  test('priority breaks ties at equal urgency', () => {
    assert.ok(
      scored({ priority: 'P0', dueDate: '2026-10-07' }) >
        scored({ priority: 'P2', dueDate: '2026-10-07' }),
    );
  });

  test('blocked work scores above unblocked work with the same deadline', () => {
    assert.ok(
      scored({ priority: 'P2', dueDate: '2026-10-07', status: TaskStatus.Blocked }) >
        scored({ priority: 'P2', dueDate: '2026-10-07' }),
    );
  });

  test('completed work scores zero', () => {
    assert.equal(scored({ priority: 'P0', dueDate: '2026-01-01', status: TaskStatus.Completed }), 0);
  });
});
