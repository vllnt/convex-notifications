<!-- Badges -->
[![convex-component](https://img.shields.io/badge/convex-component-EE342F.svg)](https://www.convex.dev/components)
[![npm](https://img.shields.io/npm/v/@vllnt/convex-notifications.svg)](https://www.npmjs.com/package/@vllnt/convex-notifications)
[![CI](https://github.com/vllnt/convex-notifications/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-notifications/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@vllnt/convex-notifications.svg)](./LICENSE)

# @vllnt/convex-notifications

A per-subject directed inbox — notifications with read/unread state and fan-out,
as a Convex component.

`deliver` a notification to one or many opaque `subjectRef`s; each recipient's UI
lists their inbox (all or unread-only, paginated, reactively in Convex), reads the
unread count, and marks notifications read. This is a **directed inbox** (push,
with read state) — distinct from an activity feed (an actor's own pull timeline).
Domain-neutral: "you were mentioned", "your turn", "invite accepted" — the `type`
and `payload` are the host's. The host owns the recipient, meaning, and auth; this
component owns only the inbox.

## Features

- **Deliver + fan-out** — `deliver(subjectRef | subjectRefs[], type, payload?)` writes one notification per recipient and returns a minted `notificationId` for each. An empty or over-`maxFanOut` recipient set is rejected.
- **Read state** — every notification is delivered unread; `markRead(notificationId)` marks one read (idempotent), `markAllRead(subjectRef)` clears a subject's whole unread inbox in bounded, self-rescheduling batches.
- **Inbox queries** — `list(subjectRef, paginationOpts, { unreadOnly? })` pages a subject's inbox newest-first via the standard Convex pagination envelope; `unreadCount(subjectRef)` returns the unread total; `get(notificationId)` returns one notification. Reactive in a Convex query.
- **Subject-bounded reads** — a `list`/`unreadCount` for one subject never spans another subject's rows; the indexes are subject-keyed, so an inbox is never a footgun.
- **Server-sourced time** — `createdAt`/`readAt` are stamped from the server clock inside every handler; a caller can never supply a timestamp.
- **Typed, opaque host data** — `Notifications<TPayload>` types the stored `payload` end to end; pass `payloadValidator` to narrow the opaque value at the boundary (no unchecked cast, no `v.any()` dump). The component stores it opaquely.
- **Bounded purge + cron** — a built-in daily purge cron sweeps **read** notifications past a retention window in bounded batches and self-reschedules until the tail is clean; idempotent. Unread notifications are never purged.
- **Mount-safe** — runs correctly under multiple named `app.use` mounts; each instance is an isolated sandbox.

## Architecture

```
src/
├── shared.ts              # constants (component name, retention, batch, fan-out cap)
├── test.ts                # convex-test register() helper
├── client/                # Notifications class (the public API)
└── component/             # schema (notifications) + mutations + queries + purge cron
```

Sandboxed table: `notifications {notificationId, subjectRef, type, payload?, read,
readAt?, createdAt}` — indexed for lookup (`by_notification_id`), a subject's inbox
(`by_subject_created`), a subject's unread slice and count
(`by_subject_read_created`), and the retention sweep (`by_read_created`). No host
tables are touched. A built-in cron (`crons.ts`) purges read notifications daily.

Channel fan-out (email/push) is **out of scope** for the inbox: the host reads a
notification (or subscribes) and routes to `@vllnt/convex-email` /
`@convex-dev/expo-push-notifications` itself, keeping this component a pure inbox.

## Installation

```bash
pnpm add @vllnt/convex-notifications
```

Peer dependency: `convex@^1.41.0`.

## Usage

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import notifications from "@vllnt/convex-notifications/convex.config";

const app = defineApp();
app.use(notifications);
export default app;
```

```ts
// convex/notify.ts — host owns auth; pass opaque subjectRefs in.
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Notifications } from "@vllnt/convex-notifications";

const inbox = new Notifications<{ actor: string }>(components.notifications, {
  payloadValidator: v.object({ actor: v.string() }).parse, // narrow at the boundary
});

// Deliver — fan a "mention" out to several recipients.
export const notifyMention = mutation({
  args: { recipients: v.array(v.string()), actor: v.string() },
  handler: (ctx, { recipients, actor }) =>
    inbox.deliver(ctx, recipients, "mention", { actor }),
});

// Read — a recipient's unread inbox, reactively.
export const myUnread = query({
  args: { subjectRef: v.string(), paginationOpts: v.any() },
  handler: (ctx, { subjectRef, paginationOpts }) =>
    inbox.list(ctx, subjectRef, paginationOpts, { unreadOnly: true }),
});

export const myUnreadCount = query({
  args: { subjectRef: v.string() },
  handler: (ctx, { subjectRef }) => inbox.unreadCount(ctx, subjectRef),
});

// Mark read.
export const dismiss = mutation({
  args: { notificationId: v.string() },
  handler: (ctx, { notificationId }) => inbox.markRead(ctx, notificationId),
});
```

## API Reference

See [docs/API.md](docs/API.md). Summary:

| Method | Kind | Result |
|--------|------|--------|
| `deliver(ctx, subjects, type, payload?)` | mutation | `{ notificationIds }` (`subjects`: one ref or an array) |
| `markRead(ctx, notificationId)` | mutation | `null` |
| `markAllRead(ctx, subjectRef, opts?)` | mutation | `number` (marked in the first bounded pass) |
| `get(ctx, notificationId)` | query | `NotificationView \| null` |
| `list(ctx, subjectRef, paginationOpts, opts?)` | query | `PaginationResult<NotificationView>` (`opts`: `{ unreadOnly? }`) |
| `unreadCount(ctx, subjectRef)` | query | `number` |
| `purge(ctx, opts?)` | mutation | `number` (read notifications removed in the first bounded pass) |

Client options:
`new Notifications(component, { payloadValidator?, maxFanOut? })`.
`markAllRead`/`purge` opts: `{ batch? }`; `purge` also `{ before? }`
(defaults `before = Date.now()`, `batch = 200`, `maxFanOut = 256`).

## React

This component ships **backend-only** — no `./react` entry. An inbox, unread
count, and unread list are ordinary reactive `useQuery` calls over the host's own
re-exported `list` / `unreadCount` / `get` function refs (those return live in
Convex), so a dedicated hook would add a wrapper with no value over the host's
existing `api`.

## Security Model

The component is **auth-agnostic**: it never authenticates or authorizes. The host
resolves identity, decides whether a caller may deliver to or read a given
`subjectRef`, and passes opaque refs. Component tables are sandboxed — the host
reaches them only through the exported functions, and the component never reads
host or sibling tables. `subjectRef`, `notificationId`, `type`, and the stored
`payload` are opaque to the component; it never inspects or de-references them.

A `list`/`unreadCount` is **subject-bounded** — it returns only the queried
subject's rows, never another subject's inbox. **Time is server-sourced** —
`createdAt` and `readAt` come from `Date.now()` inside each handler, never from the
caller. The host may narrow the opaque `payload` with `payloadValidator`, applied
at the client boundary on both write and read.

## Testing

```bash
pnpm test           # single run
pnpm test:coverage  # enforced 100% on covered files
```

Tests run against the real component runtime via `convex-test` (`@edge-runtime/vm`), not mocks.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Author

Built by [bntvllnt](https://github.com/bntvllnt) · [bntvllnt.com](https://bntvllnt.com) · [X @bntvllnt](https://x.com/bntvllnt)

Part of the [@vllnt](https://github.com/vllnt) Convex component fleet — [vllnt.com](https://vllnt.com)

If this is useful, [sponsor the work](https://github.com/sponsors/bntvllnt).

## License

MIT — see [LICENSE](LICENSE).
