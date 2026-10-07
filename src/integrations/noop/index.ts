/**
 * No-op implementations of every integration port.
 *
 * Layer 1 ships with these wired in: calls succeed as "disabled" rather than
 * throwing, so calling code never needs to branch on whether an integration
 * exists. Notifications in particular are computed but never delivered.
 */
import {
  disabled,
  type StorageProvider,
  type IssueTracker,
  type CalendarProvider,
  type Notifier,
  type ExternalLink,
  type IntegrationResult,
} from '../types.ts';

export const noopStorage: StorageProvider = {
  name: 'noop-storage',
  enabled: false,
  async resolveLink(): Promise<IntegrationResult<ExternalLink>> {
    return disabled('Google Drive');
  },
  async ensureTaskFolder(): Promise<IntegrationResult<ExternalLink>> {
    return disabled('Google Drive');
  },
};

export const noopIssues: IssueTracker = {
  name: 'noop-issues',
  enabled: false,
  async linkIssue(): Promise<IntegrationResult<ExternalLink>> {
    return disabled('GitHub');
  },
  async listLinkedActivity(): Promise<IntegrationResult<readonly ExternalLink[]>> {
    return disabled('GitHub');
  },
};

export const noopCalendar: CalendarProvider = {
  name: 'noop-calendar',
  enabled: false,
  async upsertEvent(): Promise<IntegrationResult<ExternalLink>> {
    return disabled('Google Calendar');
  },
  async removeEvent(): Promise<IntegrationResult<void>> {
    return disabled('Google Calendar');
  },
};

export const noopNotifier: Notifier = {
  name: 'noop-notifier',
  enabled: false,
  async send(): Promise<IntegrationResult<void>> {
    return disabled('Notifications');
  },
};
