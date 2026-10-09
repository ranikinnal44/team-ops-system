import type { Route } from '../http.ts';
import {
  supplyRegister, updateSupplyItem, createSupplyItem, deleteSupplyItem,
} from '../../services/supply.service.ts';
import {
  object, str, oneOf, isoDate, int, bool, optional, nullable, parseOrThrow,
} from '../../lib/validate.ts';

const createSchema = object({
  milestoneId: str({ max: 64 }),
  label: str({ max: 160 }),
  kind: oneOf(['order', 'risk'] as const),
  leadTimeWeeks: optional(nullable(int({ min: 1, max: 104 }))),
  orderByDate: optional(nullable(isoDate())),
  neededByDate: optional(nullable(isoDate())),
  critical: optional(bool()),
  note: optional(nullable(str({ max: 2000 }))),
});

const SUPPLY_STATUSES = ['not_ordered', 'ordered', 'received', 'not_needed'] as const;

const updateSchema = object({
  status: optional(oneOf(SUPPLY_STATUSES)),
  orderedOn: optional(nullable(isoDate())),
  receivedOn: optional(nullable(isoDate())),
  ownerId: optional(nullable(str({ max: 64 }))),
  note: optional(nullable(str({ max: 2000 }))),
  orderByDate: optional(nullable(isoDate())),
  neededByDate: optional(nullable(isoDate())),
});

export const supplyRoutes: Route[] = [
  {
    // Readable by everyone: an eight-week item becoming the critical path is
    // the team's problem, not just the Task Assigner's.
    method: 'GET',
    path: '/api/supply',
    handler: ({ db }) => supplyRegister(db),
  },
  {
    method: 'POST',
    path: '/api/supply',
    status: 201,
    handler: ({ db, actor, body }) => createSupplyItem(db, actor, parseOrThrow(createSchema, body)),
  },
  {
    method: 'DELETE',
    path: '/api/supply/:id',
    handler: ({ db, actor, params }) => {
      deleteSupplyItem(db, actor, params.id as string);
      return { ok: true };
    },
  },
  {
    method: 'PATCH',
    path: '/api/supply/:id',
    handler: ({ db, actor, params, body }) =>
      updateSupplyItem(db, actor, params.id as string, parseOrThrow(updateSchema, body)),
  },
];
