import type { Route } from '../http.ts';
import * as team from '../../services/team.service.ts';
import { ROLES } from '../../domain/enums.ts';
import { object, str, oneOf, bool, optional, nullable, parseOrThrow } from '../../lib/validate.ts';

const newMemberSchema = object({
  name: str({ max: 120 }),
  email: str({ max: 200 }),
  role: oneOf(ROLES),
  title: optional(nullable(str({ max: 120 }))),
});

const memberPatchSchema = object({
  name: optional(str({ max: 120 })),
  role: optional(oneOf(ROLES)),
  title: optional(nullable(str({ max: 120 }))),
  active: optional(bool()),
});

export const teamRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/team',
    handler: ({ db, actor, query }) =>
      team.listTeam(db, actor, { includeInactive: query.get('includeInactive') === 'true' }),
  },
  {
    method: 'POST',
    path: '/api/team',
    status: 201,
    handler: ({ db, actor, body }) =>
      team.addTeamMember(db, actor, parseOrThrow(newMemberSchema, body)),
  },
  {
    method: 'PATCH',
    path: '/api/team/:id',
    handler: ({ db, actor, params, body }) =>
      team.updateTeamMember(db, actor, params.id as string, parseOrThrow(memberPatchSchema, body)),
  },
];
