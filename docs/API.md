# API Reference — @vllnt/convex-notifications

**Compatibility:** `convex@^1.41.0`

Construct the client with the mounted component and optional host config:

```ts
import { Notifications } from "@vllnt/convex-notifications";
import { v } from "convex/values";

const inbox = new Notifications<MyPayload>(components.notifications, {
  payloadValidator: v.object({ actor: v.string() }).parse, // narrow stored payload
  maxFanOut: 256, // cap a single deliver fan-out (default 256)
});
```

`Notifications<TPayload = unknown>` is generic over the host's opaque `payload`
type. All methods take the host `ctx` (a query or mutation context) as the first
argument.

**Time is server-sourced.** Every handler stamps `createdAt`/`readAt` from
`Date.now()` itself; no method accepts a caller-supplied clock.

**Validation.** When `payloadValidator` is set it runs at the client boundary:
over the value written by `deliver` (before storage) and over the value returned by
`get` / `list` (on read). It must return the typed value or throw. Omit it to leave
the opaque data unvalidated.

## Mutations

### `deliver(ctx, subjects, type, payload?) → { notificationIds }`

`subjects` is a single opaque `subjectRef` or an array of them. Deliver one
notification to each recipient — the fan-out. Each row is minted a component
`notificationId`, inserted unread, with `createdAt` stamped from the server clock.
`type` tags the notification; `payload` is opaque host data validated against
`payloadValidator` before storage. Returns one `notificationId` per recipient, in
order.

An empty recipient set throws `ConvexError({ code: "EMPTY_FANOUT" })`; a set larger
than the client's `maxFanOut` throws `ConvexError({ code: "FANOUT_TOO_LARGE" })`, so
one mutation can never silently amplify past the transaction write budget.

### `markRead(ctx, notificationId) → null`

Mark one notification read, stamping `readAt` from the server clock. Idempotent —
re-marking a read notification is a no-op. A missing id throws
`ConvexError({ code: "NOT_FOUND" })`.

### `markAllRead(ctx, subjectRef, opts?) → number`

`opts`: `{ batch?: number }` (default `batch = 200`).

Mark every unread notification for `subjectRef` read, oldest first, sharing one
server-clock `readAt`. Returns the count marked in the first pass. If a full batch
was marked the sweep self-reschedules through the component scheduler until the
unread tail is clean. Idempotent — an already-empty unread inbox marks nothing.

### `purge(ctx, opts?) → number`

`opts`: `{ before?: number; batch?: number }` (defaults: `before = Date.now()`,
`batch = 200`).

Delete up to `batch` **read** notifications whose `createdAt < before`, oldest
first via the `by_read_created` index, and return the count removed in the first
pass. Unread notifications are never purged. If a full batch was removed the sweep
self-reschedules until the read tail is clean. Idempotent — safe to run anytime. A
built-in daily cron drives it automatically; call `purge` directly only for an
extra or custom-cadence sweep.

## Queries

### `get(ctx, notificationId) → NotificationView | null`

The current notification for `notificationId`, or `null` if none is held.
`NotificationView` is `{ notificationId, subjectRef, type, payload?, readAt?,
createdAt }`; `payload` is narrowed by the host validator when set; `readAt` is
absent while unread.

### `list(ctx, subjectRef, paginationOpts, opts?) → PaginationResult<NotificationView>`

`opts`: `{ unreadOnly?: boolean }` (default `false`).

Page a subject's inbox, newest first. With `unreadOnly`, only unread notifications
are returned (via the `by_subject_read_created` index, `read == false`); otherwise
the whole inbox via `by_subject_created`. Takes the standard Convex
`paginationOpts` and returns the standard paginated envelope (`page`, `isDone`,
`continueCursor`) with each row narrowed to the typed view. **Subject-bounded** —
never returns another subject's rows.

### `unreadCount(ctx, subjectRef) → number`

The number of unread notifications for `subjectRef`, via the
`by_subject_read_created` index. Subject-bounded. The count walks the unread slice;
a host expecting very large unread inboxes pairs this with `@convex-dev/aggregate`.

## Error codes

Coded `ConvexError`s thrown by the component (`error.data.code`):

| Code | Thrown by | Meaning |
|------|-----------|---------|
| `EMPTY_FANOUT` | `deliver` | The recipient set was empty. |
| `FANOUT_TOO_LARGE` | `deliver` | The recipient set exceeded the client's `maxFanOut`. |
| `NOT_FOUND` | `markRead` | No notification has this `notificationId`. |

## Cron / Maintenance

The component registers one cron (`crons.ts`):

| Job | Cadence | Action |
|-----|---------|--------|
| `notifications:purge` | every 24h (`PURGE_INTERVAL`) | runs `purge` with `batch = PURGE_BATCH` (200), self-rescheduling until the read tail is clean |

Cadence is a static module constant (Convex cron definitions are static per
deployment). A host wanting a different cadence drives `purge` from its own
scheduler with an explicit `before` cutoff. The cron is per-mount, so each
`app.use(component, { name })` instance purges its own sandbox independently.
