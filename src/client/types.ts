/** Public TypeScript surface for the notifications client. */

/**
 * Validates and narrows an opaque stored value to a host type `T` at the client
 * boundary. Receives the raw value the component returned (`unknown`) and MUST
 * return a typed `T` or throw. A `convex/values` validator's `.parse` (or a Zod
 * `.parse`) fits directly; omit it to keep the value unvalidated.
 *
 * @typeParam T - The host's stored type (a notification `payload`).
 */
export type Parser<T> = (value: unknown) => T;

/** The public projection returned by {@link Notifications.get} / `list`. */
export interface NotificationView<TPayload = unknown> {
  /** The component-minted id naming this notification. */
  notificationId: string;
  /** The host-opaque recipient this notification is addressed at. */
  subjectRef: string;
  /** The host-supplied type tag (e.g. "mention", "invite_accepted"). */
  type: string;
  /** The opaque host payload (narrowed if a `payloadValidator` is set). */
  payload?: TPayload;
  /** Absolute ms timestamp the notification was marked read; absent while unread. */
  readAt?: number;
  /** Absolute ms timestamp the notification was delivered. */
  createdAt: number;
}

/** Per-call options for {@link Notifications.list}. */
export interface ListOptions {
  /** Return only unread notifications (default `false` — the whole inbox). */
  unreadOnly?: boolean;
}

/** Construction options for the {@link Notifications} client. */
export interface NotificationsOptions<TPayload> {
  /**
   * Validates/narrows a stored `payload` to `TPayload` at the boundary — applied
   * to the `payload` passed into `deliver` (before storage) and the `payload`
   * returned by `get` / `list`. Throws on a mismatch. Omit to leave payloads
   * unvalidated.
   */
  payloadValidator?: Parser<TPayload>;
  /**
   * Hard cap on a single `deliver` fan-out's recipient count. Defaults to
   * `DEFAULT_MAX_FANOUT` (256); bounds the write amplification of one mutation.
   */
  maxFanOut?: number;
}
