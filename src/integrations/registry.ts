/**
 * Resolves which integration implementation is active.
 *
 * Every flag is false in Layer 1, so this always returns the no-op set. When a
 * real provider is added, it is selected here and nowhere else.
 */
import { config } from '../config/index.ts';
import type { IntegrationRegistry } from './types.ts';
import { noopStorage, noopIssues, noopCalendar, noopNotifier } from './noop/index.ts';

let registry: IntegrationRegistry | undefined;

export function getIntegrations(): IntegrationRegistry {
  registry ??= {
    // Layer 2: `config.integrations.driveEnabled ? googleDrive() : noopStorage`
    storage: noopStorage,
    issues: noopIssues,
    calendar: noopCalendar,
    notifier: noopNotifier,
  };
  return registry;
}

/** Reported on the health endpoint so the UI can show what is live. */
export function integrationStatus(): Record<string, boolean> {
  return {
    googleDrive: config.integrations.driveEnabled,
    github: config.integrations.githubEnabled,
    googleCalendar: config.integrations.calendarEnabled,
    notifications: config.integrations.notificationsEnabled,
  };
}
