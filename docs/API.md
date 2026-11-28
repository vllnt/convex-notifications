# API Reference — @vllnt/convex-notifications

**Compatibility:** `convex@^1.45.0`. This file ships in the npm package at
`node_modules/@vllnt/convex-notifications/docs/API.md` and matches the installed
version.

## Entry points

| Import                                                         | Exports                                                                                                                |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `@vllnt/convex-notifications`                                  | `Notifications` class; types `NotificationsComponent`, `NotificationsOptions`, `NotificationView`, `ListOptions`, `Parser` |
| `@vllnt/convex-notifications/convex.config` (or `.js`)         | default component config for `app.use(...)`                                                                            |
| `@vllnt/convex-notifications/test`                             | `register(t, name = "notifications")` for `convex-test` (TypeScript source; needs Vite `import.meta.glob`)             |
| `@vllnt/convex-notifications/_generated/component` (or `.js`)  | type `ComponentApi`                                                                                                    |

`subjectRef` (the recipient) and `type` are opaque host strings; the component
only requires them to be non-empty where noted. `payload` is any Convex value,
stored as given. Every timestamp (`createdAt`, `readAt`) is read from the server
clock inside the handler; no method accepts a caller time.

## Client

### `Notifications`

```ts
// Signature:
new Notifications<TPayload = unknown>(
  component: NotificationsComponent,
  options?: NotificationsOptions<TPayload>,
)
```

`component` is the mounted component, `components.notifications` (or the name
passed to `app.use`). When `TPayload` is not `unknown`, `options` is required and
must include `payloadValidator`. `maxFanOut` defaults to 256; a value that is not
an integer from 1 to 500 throws a `RangeError` from the constructor.

Mutation methods need a context with `runMutation` (a mutation or action
context); query methods need one with `runQuery`.

### `deliver`

```ts
// Signature:
deliver(ctx, subjects: string | string[], type: string, payload?: TPayload): Promise<{ notificationIds: string[] }>
```

Inserts one unread notification per entry of `subjects` and returns one minted
`notificationId` (`crypto.randomUUID()`) per entry, in order. All rows of one
call share one `createdAt`. A defined `payload` is passed through
`payloadValidator` first, and the parser's return value is stored.

Throws `EMPTY_FANOUT` for an empty array, `FANOUT_TOO_LARGE` for more entries
than `maxFanOut`, `INVALID_TYPE` for `type: ""` and `INVALID_SUBJECT_REF` for an
empty entry, before writing anything. Entries are not deduplicated, and repeated
calls create new rows: `deliver` is not idempotent. The component also checks
the `maxFanOut` it receives (`INVALID_MAX_FANOUT`), which only a direct
component call can get wrong.

### `markRead`

```ts
// Signature:
markRead(ctx, notificationId: string, opts?: { subjectRef?: string }): Promise<null>
```

Marks one notification read and stamps `readAt`. Marking a read notification
again does nothing and keeps the first `readAt`. Throws `NOT_FOUND` when no
notification has the id, or, when `opts.subjectRef` is passed, when the
notification is addressed to a different recipient (it stays unread). Without
`opts.subjectRef` the id alone is trusted.

### `markAllRead`

```ts
// Signature:
markAllRead(ctx, subjectRef: string, opts?: { batch?: number }): Promise<number>
```

Marks up to `batch` (default 200, integer from 1 to 500) of the recipient's
unread notifications read, oldest first, with one `readAt` per batch. When a full
batch was marked it schedules itself for the next batch. Returns the count
marked by this call's batch only. Throws `INVALID_BATCH` and, for
`subjectRef: ""`, `INVALID_SUBJECT_REF`.

### `get`

```ts
// Signature:
get(ctx, notificationId: string, opts?: { subjectRef?: string }): Promise<NotificationView<TPayload> | null>
```

The notification, or `null` when no notification has the id or, with
`opts.subjectRef`, when it is addressed to a different recipient. The payload
goes through `payloadValidator` when one is set.

### `list`

```ts
// Signature:
list(ctx, subjectRef: string, paginationOpts: PaginationOptions, opts?: ListOptions): Promise<PaginationResult<NotificationView<TPayload>>>
```

One page of the recipient's notifications, newest first (by `createdAt`). With
`{ unreadOnly: true }` only unread ones. Takes the standard Convex
`paginationOpts` (validate it with `paginationOptsValidator` from
`convex/server`) and returns the standard envelope: `page`, `isDone`,
`continueCursor`, and optional `splitCursor` and `pageStatus`. A read for one
`subjectRef` never returns another recipient's rows. Each payload goes through
`payloadValidator`; one that fails makes the whole call throw.

### `unreadCount`

```ts
// Signature:
unreadCount(ctx, subjectRef: string): Promise<number>
```

The number of unread notifications for the recipient. It is kept in the nested
`@convex-dev/aggregate` component, updated in the same transaction as each
`deliver`, `markRead` and `markAllRead`, so the count does not scan the inbox.

### `purge`

```ts
// Signature:
purge(ctx, opts?: { before?: number; batch?: number }): Promise<number>
```

Deletes up to `batch` (default 200, integer from 1 to 500) **read**
notifications with `createdAt < before`, oldest first across all recipients.
`before` defaults to the server time minus 30 days. When a full batch was
deleted it schedules itself with the same `before`. Returns the count deleted by
this call's batch only. Unread notifications are never deleted. Throws
`INVALID_BATCH`, and `INVALID_BEFORE` for a non-finite `before`.

The component's own cron runs `purge` with `batch` 200 and the 30-day default
every 24 hours (see [Cron](#cron)); call `purge` yourself only to delete sooner.

## Types

### `NotificationsComponent`

The type of `components.notifications`: the component's `mutations` (`deliver`,
`markRead`, `markAllRead`, `purge`) and `queries` (`get`, `list`,
`unreadCount`) function references, with `payload` typed `unknown`.

### `NotificationsOptions`

```ts
// Signature:
interface NotificationsOptions<TPayload> {
  payloadValidator?: Parser<TPayload>;
  maxFanOut?: number;
}
```

`payloadValidator` narrows payloads on `deliver` (before storage) and on `get` /
`list`. `maxFanOut` caps one `deliver` call (default 256, integer from 1 to 500).

### `NotificationView`

```ts
// Signature:
interface NotificationView<TPayload = unknown> {
  notificationId: string;
  subjectRef: string;
  type: string;
  payload?: TPayload;
  readAt?: number;
  createdAt: number;
}
```

`readAt` is absent while the notification is unread. There is no `read` field.

### `ListOptions`

```ts
// Signature:
interface ListOptions {
  unreadOnly?: boolean;
}
```

`unreadOnly` defaults to `false` (the whole inbox).

### `Parser`

```ts
// Signature:
type Parser<T> = (value: unknown) => T;
```

Returns the narrowed value or throws. A schema library's parse function (such as
Zod's `.parse`) fits; `convex/values` validators have no `parse` method, so
write a type-guarding function for them.

## Other entry points

### `convex.config`

`import notifications from "@vllnt/convex-notifications/convex.config"` is the
component definition, named `notifications`. Mount it with
`app.use(notifications)`, or `app.use(notifications, { name })` for another,
separate instance with its own table and cron. It nests `@convex-dev/aggregate`.

### `register`

```ts
// Signature:
register<TSchema extends GenericSchema>(t: TestConvex<SchemaDefinition<TSchema, boolean>>, name = "notifications"): void
```

Registers the component and its nested aggregate (`<name>/aggregate`) in a host
`convexTest(schema, modules)` instance, for any host schema. Pass the mount
name when the app uses `app.use(notifications, { name })`. It is TypeScript
source that calls Vite's `import.meta.glob`, so run it under Vitest.

### `ComponentApi`

`import type { ComponentApi } from "@vllnt/convex-notifications/_generated/component"`
is the Convex-generated type of the mounted component. It is type-only and is
assignable to `NotificationsComponent`.

## Errors

Component errors are `ConvexError`s with `data: { code, message }`:

| Code                  | Thrown by                | Meaning                                                                       |
| --------------------- | ------------------------ | ----------------------------------------------------------------------------- |
| `EMPTY_FANOUT`        | `deliver`                | The recipient array was empty.                                                |
| `FANOUT_TOO_LARGE`    | `deliver`                | The recipient array had more entries than the client's `maxFanOut`.           |
| `INVALID_MAX_FANOUT`  | `deliver`                | The `maxFanOut` sent to the component was not an integer from 1 to 500.      |
| `INVALID_TYPE`        | `deliver`                | `type` was an empty string.                                                   |
| `INVALID_SUBJECT_REF` | `deliver`, `markAllRead` | A `subjectRef` was an empty string.                                           |
| `INVALID_BATCH`       | `markAllRead`, `purge`   | `batch` was not an integer from 1 to 500.                                     |
| `INVALID_BEFORE`      | `purge`                  | `before` was not finite.                                                      |
| `NOT_FOUND`           | `markRead`               | No notification has this id (for the given `subjectRef`, if passed).         |

The client constructor throws a plain `RangeError` (no code) for an invalid
`maxFanOut`. Errors thrown by your `payloadValidator` reach the caller
unchanged. Causes and fixes:
[README errors and fixes](../README.md#errors-and-fixes).

## Cron

The component registers one cron in `crons.ts`:

| Job                   | Cadence        | Action                                                                  |
| --------------------- | -------------- | ----------------------------------------------------------------------- |
| `notifications:purge` | every 24 hours | `purge` with `batch` 200 and the 30-day default, repeating while full |

The cadence and retention are constants; the cron cannot be disabled or
lengthened. Each mount runs its own cron over its own table.
