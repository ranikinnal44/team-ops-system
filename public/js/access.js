/**
 * Who may open a screen, and who counts as a Task Assigner.
 *
 * A reviewer has every power a Task Assigner has; the roles differ in what
 * each is expected to do, not in what the system allows. Every "may this
 * person plan, assign or manage?" question goes through `isTaskAssigner`, so
 * the two cannot drift apart.
 *
 * Kept apart from the router so it can be checked against the server's own
 * capabilities: a screen the server allows but the router bars sends people
 * back to My work with no explanation.
 */
export const isTaskAssigner = (role) => role === 'manager' || role === 'reviewer';

export const ACCESS = {
  /** Plan, Team, the Dashboard, creating tasks. */
  assigner: ['manager', 'reviewer'],
};

/** A route with no `access` is open to everyone signed in. */
export const canOpen = (route, role) => !route.access || route.access.includes(role);
