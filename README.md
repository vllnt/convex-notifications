<!-- Badges -->

[![convex-component](https://img.shields.io/badge/convex-component-EE342F.svg)](https://www.convex.dev/components)
[![npm](https://img.shields.io/npm/v/@vllnt/convex-notifications.svg)](https://www.npmjs.com/package/@vllnt/convex-notifications)
[![CI](https://github.com/vllnt/convex-notifications/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-notifications/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@vllnt/convex-notifications.svg)](./LICENSE)

# @vllnt/convex-notifications

A per-subject directed inbox — notifications with read/unread state and fan-out,
as a Convex component.

```ts
const inbox = new Notifications(components.notifications);
await inbox.deliver(ctx, recipients, "mention", { actor }); // one row per recipient
await inbox.list(ctx, subjectRef, paginationOpts, { unreadOnly: true }); // reactive inbox
await inbox.unreadCount(ctx, subjectRef);
await inbox.markRead(ctx, notificationId);
```

## Features

- **Deliver + fan-out** — `deliver(subjectRef | subjectRefs[], type, payload?)`
  writes one notification per recipient and mints a `notificationId` for each.
- **Read state** — every notification arrives unread; `markRead` (idempotent)
  and `markAllRead` (bounded, self-rescheduling) clear it.
- **Inbox queries** — `list` pages newest-first (all or unread-only),
  `unreadCount` totals the unread, `get` fetches one. Reactive in a Convex
  query.
- **Subject-bounded reads** — a `list`/`unreadCount` is keyed to one subject and
  never spans another's inbox.
- **Server-sourced time** — `createdAt`/`readAt` are stamped from the server
  clock; a caller can't supply a timestamp.
- **Typed, opaque payload** — `Notifications<TPayload>` types the stored
  `payload`; `payloadValidator` narrows it at the boundary.
- **Bounded purge + cron** — a daily cron sweeps read notifications past
  retention in batches; unread are never purged.
- **Mount-safe** — correct under multiple named `app.use` mounts; each instance
  is an isolated sandbox.

## Installation

```bash
pnpm add @vllnt/convex-notifications@canary convex@^1.45.0
```

Peer dependency: `convex@^1.45.0`. This README follows `main` and the canary
channel; `latest` is the separate stable release. Pin an exact canary version
for reproducible installs.

## Quick start

After mounting, run `pnpm exec convex dev` to generate
`components.notifications`. These internal functions are for trusted server
callers. Public wrappers must authorize recipients, derive identity, and verify
ownership before reading or marking an id.

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
import { internalMutation, internalQuery } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { Notifications } from "@vllnt/convex-notifications";

const inbox = new Notifications<{ actor: string }>(components.notifications, {
  payloadValidator: (value) => {
    if (
      typeof value !== "object" ||
      value === null ||
      !("actor" in value) ||
      typeof value.actor !== "string"
    ) {
      throw new Error("Expected an actor string");
    }
    return { actor: value.actor };
  },
});

export const notifyMention = internalMutation({
  args: { recipients: v.array(v.string()), actor: v.string() },
  handler: (ctx, { recipients, actor }) =>
    inbox.deliver(ctx, recipients, "mention", { actor }),
});

export const myUnread = internalQuery({
  args: { subjectRef: v.string(), paginationOpts: paginationOptsValidator },
  handler: (ctx, { subjectRef, paginationOpts }) =>
    inbox.list(ctx, subjectRef, paginationOpts, { unreadOnly: true }),
});
```

## API Reference

| Method                                         | Kind     | Result                                                           |
| ---------------------------------------------- | -------- | ---------------------------------------------------------------- |
| `deliver(ctx, subjects, type, payload?)`       | mutation | `{ notificationIds }` (`subjects`: one ref or an array)          |
| `markRead(ctx, notificationId)`                | mutation | `null`                                                           |
| `markAllRead(ctx, subjectRef, opts?)`          | mutation | `number` (marked in the first bounded pass)                      |
| `get(ctx, notificationId)`                     | query    | `NotificationView \| null`                                       |
| `list(ctx, subjectRef, paginationOpts, opts?)` | query    | `PaginationResult<NotificationView>` (`opts`: `{ unreadOnly? }`) |
| `unreadCount(ctx, subjectRef)`                 | query    | `number`                                                         |
| `purge(ctx, opts?)`                            | mutation | `number` (read notifications removed in the first bounded pass)  |

Full reference: [docs/API.md](docs/API.md).

## Options and limitations

- `payloadValidator` is required for a typed `Notifications<TPayload>`; use a
  parser `(unknown) => TPayload`, not `v.*.parse`. The default
  `Notifications<unknown>` permits unvalidated payloads.
- `maxFanOut` defaults to 256 and must be an integer from 1–500 (invalid
  constructor values throw `RangeError`). Empty deliveries and over-cap
  deliveries throw `EMPTY_FANOUT` and `FANOUT_TOO_LARGE`. Recipients are not
  deduplicated; repeated delivery creates new rows.
- `markAllRead` and `purge` accept batch sizes 1–500 (default 200) and return
  the first pass's count. Later passes run asynchronously.
- `unreadCount` uses the nested official `@convex-dev/aggregate`; views expose
  `readAt` (absent while unread), not a `read` boolean.
- Purge uses `createdAt`, not `readAt`, with a default 30-day window. Unread
  rows remain indefinitely. A custom cutoff does not reconfigure the built-in
  daily cron.
- Mount another inbox with `app.use(notifications, { name: "alerts" })` and
  `new Notifications(components.alerts)`.

## Integrations

Email and push delivery stay in the host; this component only stores the inbox.

Backend-only — no `./react` entry. An inbox, unread count, and unread list are
ordinary reactive `useQuery` calls over the host's own re-exported `list` /
`unreadCount` / `get` refs.

## Security

- Auth-agnostic — the host resolves identity and decides who may deliver to or
  read a `subjectRef`.
- Tables sandboxed — reached only through the exported functions; never touches
  host or sibling tables.
- Subject-bounded reads + server-sourced time; `subjectRef` / `payload` stay
  opaque to the component.

See [docs/API.md](docs/API.md).

## Testing

```bash
pnpm test           # single run
pnpm test:coverage  # enforced 100% on covered files
```

Tests run against the real component runtime via `convex-test`
(`@edge-runtime/vm`), not mocks.

## Documentation

`llms.txt` is the maintained discovery index. `pnpm generate:llms` checks its
heading and local links without generating a source bundle.

[API reference](docs/API.md) · [LLM index](llms.txt) ·
[Security policy](SECURITY.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Author

Built by [bntvllnt](https://github.com/bntvllnt) ·
[bntvllnt.com](https://bntvllnt.com) · [X @bntvllnt](https://x.com/bntvllnt)

Part of the [@vllnt](https://github.com/vllnt) Convex component fleet —
[vllnt.com](https://vllnt.com)

If this is useful, [sponsor the work](https://github.com/sponsors/bntvllnt).

## License

MIT — see [LICENSE](LICENSE).
