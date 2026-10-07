/**
 * Integration ports (Layer 2+).
 *
 * These are interfaces only. Nothing in `services/` or `api/` imports a
 * concrete provider — they depend on these contracts and receive whatever the
 * registry hands them, which in Layer 1 is always a disabled no-op.
 *
 * Adding Google Drive later means writing a `StorageProvider` and registering
 * it. No task code changes.
 */
import type { IsoDate, IsoTimestamp } from '../lib/dates.ts';

export type IntegrationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string; readonly disabled?: boolean };

export const disabled = <T>(provider: string): IntegrationResult<T> => ({
  ok: false,
  reason: `${provider} integration is disabled in this deployment.`,
  disabled: true,
});

/** A link stored against a task; mirrors the `task_external_links` table. */
export type ExternalLink = {
  readonly provider: string;
  readonly kind: string;
  readonly externalId: string | null;
  readonly url: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

/** Google Drive and anything else that holds evidence documents. */
export type StorageProvider = {
  readonly name: string;
  readonly enabled: boolean;
  /** Resolve a pasted URL into a structured link (document id, folder id, ...). */
  resolveLink(url: string): Promise<IntegrationResult<ExternalLink>>;
  /** Create a per-task evidence folder. */
  ensureTaskFolder(taskRef: string): Promise<IntegrationResult<ExternalLink>>;
};

/** GitHub and equivalents. */
export type IssueTracker = {
  readonly name: string;
  readonly enabled: boolean;
  linkIssue(taskRef: string, issueUrl: string): Promise<IntegrationResult<ExternalLink>>;
  listLinkedActivity(taskRef: string): Promise<IntegrationResult<readonly ExternalLink[]>>;
};

export type CalendarEventKind = 'deadline' | 'meeting' | 'review_meeting';

export type CalendarEventRequest = {
  readonly taskRef: string;
  readonly title: string;
  readonly kind: CalendarEventKind;
  readonly date: IsoDate;
  readonly attendeeEmails: readonly string[];
};

export type CalendarProvider = {
  readonly name: string;
  readonly enabled: boolean;
  upsertEvent(request: CalendarEventRequest): Promise<IntegrationResult<ExternalLink>>;
  removeEvent(externalId: string): Promise<IntegrationResult<void>>;
};

export type NotificationChannel = 'email' | 'google_chat' | 'slack';

export type NotificationMessage = {
  readonly channel: NotificationChannel;
  readonly to: readonly string[];
  readonly subject: string;
  readonly body: string;
  /** Set when the message was triggered by an exception rule. */
  readonly triggeredBy?: { readonly taskRef: string; readonly flag: string; readonly at: IsoTimestamp };
};

export type Notifier = {
  readonly name: string;
  readonly enabled: boolean;
  send(message: NotificationMessage): Promise<IntegrationResult<void>>;
};

export type IntegrationRegistry = {
  readonly storage: StorageProvider;
  readonly issues: IssueTracker;
  readonly calendar: CalendarProvider;
  readonly notifier: Notifier;
};
