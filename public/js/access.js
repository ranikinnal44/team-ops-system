/**
 * Who may open a screen.
 *
 * Kept apart from the router so it can be checked against the server's own
 * capabilities: a screen the server allows but the router bars sends people
 * back to My work with no explanation, which is what a reviewer saw when
 * "+ New task" was added for them but this table was not.
 */
export const ACCESS = {
  /** Plan, Team, the roster. */
  manager: ['manager'],
  /** Creating and assigning tasks: a Task Assigner or a reviewer. */
  assigner: ['manager', 'reviewer'],
};

/** A route with no `access` is open to everyone signed in. */
export const canOpen = (route, role) => !route.access || route.access.includes(role);
