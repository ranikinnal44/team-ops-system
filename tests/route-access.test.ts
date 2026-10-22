/**
 * The browser's route table against the server's capabilities.
 *
 * A reviewer was given the right to create tasks and a "+ New task" button,
 * but the router still barred the page, so the button bounced them to My work.
 * Nothing noticed: the view tests mount a screen directly and never go through
 * the router. These checks tie the two tables together.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Role } from '../src/domain/enums.ts';
import { Capability, can } from '../src/domain/permissions.ts';
// @ts-expect-error — plain browser module, no type declarations
import { ACCESS, canOpen } from '../public/js/access.js';

const ROLES = [Role.Manager, Role.Reviewer, Role.Employee];

describe('who may open a screen', () => {
  test('the create-task screen opens for exactly the roles the server lets create tasks', () => {
    for (const role of ROLES) {
      assert.equal(
        canOpen({ access: ACCESS.assigner }, role),
        can(role, Capability.CreateTask),
        `${role}: the screen and the capability must agree`,
      );
    }
  });

  test('the plan and team screens stay with managers', () => {
    for (const role of ROLES) {
      assert.equal(canOpen({ access: ACCESS.manager }, role), role === Role.Manager);
    }
  });

  test('a screen with no restriction opens for every role', () => {
    for (const role of ROLES) assert.ok(canOpen({}, role));
  });

  test('the router uses the assigner access for /tasks/new', () => {
    const source = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
    assert.match(
      source,
      /\/\^\\\/tasks\\\/new\$\/,\s*view:\s*createTaskView,\s*access:\s*ACCESS\.assigner/,
      'the route must admit a reviewer, or "+ New task" bounces them to My work',
    );
  });
});
