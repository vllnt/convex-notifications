# @vllnt/convex-notifications

TypeScript Convex component for in-app notification inboxes: fan-out delivery,
read/unread state, unread counts, paginated lists and retention purge.

![Notifications Inbox — @vllnt/convex-notifications](https://raw.githubusercontent.com/vllnt/convex-notifications/main/.github/assets/thumbnail.png)

## For coding agents

Docs for the installed version are in `node_modules/@vllnt/convex-notifications/`:
`docs/API.md`, `llms.txt`, `CHANGELOG.md` and the TypeScript `src/`. Read them
before writing code against this package.

## When to use

- Use it when a server event must reach one or many users' in-app inboxes.
- Use it when the UI needs an unread count and an unread-only list per user.
- Use it when read notifications should be deleted after a retention window.
- Do not use it when you need an activity history with no read state: use
  `@vllnt/convex-events`.
- Do not use it when you need to send email or push: use `@vllnt/convex-email`
  or `@convex-dev/expo-push-notifications`, called from your own code.

## Install

```bash
pnpm add @vllnt/convex-notifications
```

## Quick start

```ts
// convex/convex.config.ts
import notifications from "@vllnt/convex-notifications/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(notifications);
export default app;
```

```ts
// convex/inbox.ts
import { Notifications } from "@vllnt/convex-notifications";
import { ConvexError, v } from "convex/values";

import { components } from "./_generated/api.js";
import { internalMutation, mutation, query } from "./_generated/server.js";

const inbox = new Notifications(components.notifications);

export const notifyMention = internalMutation({
  args: { recipients: v.array(v.string()), actor: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, { recipients, actor }) => {
    const { notificationIds } = await inbox.deliver(ctx, recipients, "mention", {
      actor,
    });
    return notificationIds;
  },
});

export const myUnreadCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (user === null) throw new ConvexError("not signed in");
    return inbox.unreadCount(ctx, user.tokenIdentifier);
  },
});

export const markRead = mutation({
  args: { notificationId: v.string() },
  returns: v.null(),
  handler: async (ctx, { notificationId }) => {
    const user = await ctx.auth.getUserIdentity();
    if (user === null) throw new ConvexError("not signed in");
    return inbox.markRead(ctx, notificationId, {
      subjectRef: user.tokenIdentifier,
    });
  },
});
```

Run `npx convex dev` once to generate `components.notifications`. The component
never reads auth: the host derives the recipient (`subjectRef`, here the user's
`tokenIdentifier`) and decides who may deliver to it or read it. Passing
`subjectRef` to `markRead` makes the component refuse another recipient's id.

## API

Full reference: [docs/API.md](docs/API.md).

| Export                                                                              | Import from                                         | What it does                                                         |
| ----------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------- |
| [`Notifications`](docs/API.md#notifications)                                        | `@vllnt/convex-notifications`                       | Host client: `new Notifications(components.notifications, options?)` |
| [`deliver(ctx, subjects, type, payload?)`](docs/API.md#deliver)                     | `Notifications` method, mutation                    | One unread notification per recipient; returns `{ notificationIds }` |
| [`markRead(ctx, notificationId, opts?)`](docs/API.md#markread)                      | `Notifications` method, mutation                    | Mark one read (idempotent); returns `null`                           |
| [`markAllRead(ctx, subjectRef, opts?)`](docs/API.md#markallread)                    | `Notifications` method, mutation                    | Mark all of a recipient's unread read, in batches; returns `number`  |
| [`get(ctx, notificationId, opts?)`](docs/API.md#get)                                | `Notifications` method, query                       | One notification or `null`                                           |
| [`list(ctx, subjectRef, paginationOpts, opts?)`](docs/API.md#list)                  | `Notifications` method, query                       | One page of an inbox, newest first, all or unread only               |
| [`unreadCount(ctx, subjectRef)`](docs/API.md#unreadcount)                           | `Notifications` method, query                       | Number of unread notifications                                       |
| [`purge(ctx, opts?)`](docs/API.md#purge)                                            | `Notifications` method, mutation                    | Delete read notifications older than a cutoff, in batches            |
| [`NotificationsComponent`](docs/API.md#notificationscomponent)                      | `@vllnt/convex-notifications` (type)                | Type of `components.notifications`                                   |
| [`NotificationsOptions`](docs/API.md#notificationsoptions)                          | `@vllnt/convex-notifications` (type)                | `{ payloadValidator?, maxFanOut? }`                                  |
| [`NotificationView`](docs/API.md#notificationview)                                  | `@vllnt/convex-notifications` (type)                | Result row of `get` and `list`                                       |
| [`ListOptions`](docs/API.md#listoptions)                                            | `@vllnt/convex-notifications` (type)                | `{ unreadOnly? }`                                                    |
| [`Parser`](docs/API.md#parser)                                                      | `@vllnt/convex-notifications` (type)                | `(value: unknown) => T`, the `payloadValidator` shape                |
| [`default` (component config)](docs/API.md#convexconfig)                            | `@vllnt/convex-notifications/convex.config`         | Pass to `app.use(...)`                                               |
| [`register`](docs/API.md#register)                                                  | `@vllnt/convex-notifications/test`                  | Mount the component in `convex-test`                                 |
| [`ComponentApi`](docs/API.md#componentapi)                                          | `@vllnt/convex-notifications/_generated/component`  | Generated type of the mounted component                              |

## Common tasks

Type the payload and page a signed-in user's inbox. A typed client must pass
`payloadValidator`; it runs on the payload given to `deliver` and on every
payload returned by `get` and `list`.

```ts
// convex/feed.ts
import { Notifications } from "@vllnt/convex-notifications";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";

import { components } from "./_generated/api.js";
import { mutation, query } from "./_generated/server.js";

type Mention = { actor: string };

const inbox = new Notifications<Mention>(components.notifications, {
  payloadValidator: (value): Mention => {
    if (
      typeof value !== "object" ||
      value === null ||
      !("actor" in value) ||
      typeof value.actor !== "string"
    ) {
      throw new Error("expected { actor: string }");
    }
    return { actor: value.actor };
  },
});

const notification = v.object({
  notificationId: v.string(),
  subjectRef: v.string(),
  type: v.string(),
  payload: v.optional(v.object({ actor: v.string() })),
  readAt: v.optional(v.number()),
  createdAt: v.number(),
});

export const myInbox = query({
  args: { paginationOpts: paginationOptsValidator, unreadOnly: v.boolean() },
  returns: v.object({
    page: v.array(notification),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(
      v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null()),
    ),
  }),
  handler: async (ctx, { paginationOpts, unreadOnly }) => {
    const user = await ctx.auth.getUserIdentity();
    if (user === null) throw new ConvexError("not signed in");
    return inbox.list(ctx, user.tokenIdentifier, paginationOpts, { unreadOnly });
  },
});

export const markAllRead = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (user === null) throw new ConvexError("not signed in");
    return inbox.markAllRead(ctx, user.tokenIdentifier);
  },
});
```

Deliver to more recipients than `maxFanOut` (default 256). Several `deliver`
calls in one mutation still share one transaction, so continue in a scheduled
mutation:

```ts
// convex/broadcast.ts
import { Notifications } from "@vllnt/convex-notifications";
import { v } from "convex/values";

import { components, internal } from "./_generated/api.js";
import { internalMutation } from "./_generated/server.js";

const inbox = new Notifications(components.notifications);

export const broadcast = internalMutation({
  args: { recipients: v.array(v.string()), type: v.string() },
  returns: v.null(),
  handler: async (ctx, { recipients, type }) => {
    if (recipients.length === 0) return null;
    await inbox.deliver(ctx, recipients.slice(0, 256), type);
    const rest = recipients.slice(256);
    if (rest.length > 0) {
      await ctx.scheduler.runAfter(0, internal.broadcast.broadcast, {
        recipients: rest,
        type,
      });
    }
    return null;
  },
});
```

Delete read notifications sooner than the built-in 30 days. Call it from your
own `convex/crons.ts`; the built-in daily cron keeps running.

```ts
// convex/maintenance.ts
import { Notifications } from "@vllnt/convex-notifications";
import { v } from "convex/values";

import { components } from "./_generated/api.js";
import { internalMutation } from "./_generated/server.js";

const inbox = new Notifications(components.notifications);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const purgeReadAfterAWeek = internalMutation({
  args: {},
  returns: v.number(),
  handler: (ctx) => inbox.purge(ctx, { before: Date.now() - WEEK_MS }),
});
```

Mount a second, separate inbox. Each mount has its own table and cron.

```ts
// convex/convex.config.ts
import notifications from "@vllnt/convex-notifications/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(notifications);
app.use(notifications, { name: "alerts" });
export default app;
```

```ts
// convex/alerts.ts
import { Notifications } from "@vllnt/convex-notifications";

import { components } from "./_generated/api.js";

export const alerts = new Notifications(components.alerts);
```

Show the unread count in React with `useQuery(api.inbox.myUnreadCount)` from
`convex/react`. Like any Convex query it re-runs when the data it read changes.
The package has no React entry of its own.

## Errors and fixes

Component errors are `ConvexError`s whose `data` is `{ code, message }`. Catch
one in the host with `error instanceof ConvexError` and read `error.data.code`:

```ts
// convex/announce.ts
import { Notifications } from "@vllnt/convex-notifications";
import { ConvexError, v } from "convex/values";

import { components } from "./_generated/api.js";
import { internalMutation } from "./_generated/server.js";

const inbox = new Notifications(components.notifications);

export const announce = internalMutation({
  args: { recipients: v.array(v.string()), type: v.string() },
  returns: v.union(v.array(v.string()), v.string()),
  handler: async (ctx, { recipients, type }) => {
    try {
      const { notificationIds } = await inbox.deliver(ctx, recipients, type);
      return notificationIds;
    } catch (error) {
      if (error instanceof ConvexError && typeof error.data?.code === "string") {
        return error.data.code;
      }
      throw error;
    }
  },
});
```

| Code or error                | Message                                                | Cause                                                                                      | Fix                                                                                    |
| ---------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `EMPTY_FANOUT`               | `deliver requires at least one subjectRef`             | `deliver` got an empty recipient array                                                     | Skip the call when there is nobody to notify                                           |
| `FANOUT_TOO_LARGE`           | `deliver fan-out of <n> exceeds maxFanOut <max>`       | More recipients than the client's `maxFanOut` (default 256; duplicates count)              | Split across scheduled mutations (see Common tasks), or raise `maxFanOut` (at most 500) |
| `INVALID_MAX_FANOUT`         | `maxFanOut must be an integer between 1 and 500`       | A direct call to the component's `deliver` passed a bad `maxFanOut`                        | Call through the `Notifications` client, or pass an integer from 1 to 500              |
| `INVALID_TYPE`               | `type must be a non-empty string`                      | `deliver` got `type: ""`                                                                   | Pass a non-empty type tag                                                              |
| `INVALID_SUBJECT_REF`        | `subjectRef must be a non-empty string`                | `deliver` got `""` among the recipients, or `markAllRead` got `""`                         | Pass non-empty recipient refs; nothing is written when this is thrown                  |
| `INVALID_BATCH`              | `batch must be an integer between 1 and 500`           | `markAllRead` or `purge` got a `batch` that is not an integer from 1 to 500               | Omit `batch` (default 200) or pass an integer from 1 to 500                            |
| `INVALID_BEFORE`             | `before must be finite`                                | `purge` got `before` as `NaN` or `Infinity`                                                | Pass a finite millisecond timestamp, or omit it for the 30-day default                 |
| `NOT_FOUND`                  | `notification "<id>" not found`                        | `markRead` got an unknown id, or an id addressed to a different `subjectRef` than passed   | Check the id and recipient; `get` returns `null` in the same cases                     |
| `RangeError` (not coded)     | `maxFanOut must be an integer between 1 and 500`       | `new Notifications(...)` got `maxFanOut` that is not an integer from 1 to 500             | Pass an integer from 1 to 500, or omit it for 256                                      |
| Your `payloadValidator` error | The message your parser throws                        | A payload given to `deliver`, or a stored payload read by `get` / `list`, fails the parser | Fix the payload or the parser; one bad stored row makes the whole `list` page throw   |

Arguments of the wrong type (for example a number `type`) are rejected by
Convex argument validation before the component runs.

## Limits and gotchas

- `maxFanOut` defaults to 256 and can be set from 1 to 500. The cap counts array
  entries: recipients are not deduplicated, so a repeated `subjectRef` gets two
  notifications.
- `deliver` is not idempotent. Calling it again, or retrying a producer, creates
  new notifications.
- `markAllRead` and `purge` handle `batch` rows per transaction (default 200, at
  most 500) and return only the first batch's count. Later batches run in
  scheduled mutations, so a query right after the call can still see unread or
  old rows.
- `markRead` on an already-read notification does nothing and keeps the first
  `readAt`.
- Without `opts.subjectRef`, `markRead` and `get` trust the id alone. Pass the
  authenticated recipient so another recipient's id is `NOT_FOUND` / `null`.
- `list`, `get` and `unreadCount` never throw for an unknown or empty
  `subjectRef`; they return an empty page, `null` or `0`.
- Views have no `read` field. A notification is unread when `readAt` is
  `undefined`.
- Retention is based on `createdAt`, not `readAt`. The built-in cron runs every
  24 hours and deletes read notifications created more than 30 days ago. It
  cannot be disabled or lengthened; `purge` with a later `before` only deletes
  sooner. `purge({ before: Date.now() })` deletes every read notification.
- Unread notifications are never deleted by `purge` or the cron.
- `payload` is optional even on a typed client, and the parser is not called when
  it is `undefined`. The stored payload is what the parser returned.
- Timestamps come from the server clock; no method accepts a caller time.
- Installing on `convex` 1.45.x prints an unmet-peer warning:
  `@convex-dev/aggregate` 0.3.4 and 0.3.5 both pin `convex-helpers` 0.1.128,
  which `@convex-dev/batch-worker` 0.3.3 also resolves to, and whose peer is
  `convex ^1.46.0`. The package test passes on `convex` 1.45.0.

## Compatibility

- Peer dependency: `convex@^1.45.0`. CI runs the unit tests on the locked convex
  version (1.51.0), and type-checks and runs the packed package on convex 1.45.0.
- Node.js: `package.json` `engines` is `>=18`, but `convex` itself needs Node.js
  `>=20` (1.45 to 1.48) or `>=22` (1.49 and newer). ES modules only.
- TypeScript: the package test type-checks the packed package with TypeScript
  6.0.2 and 7.0.2, with `moduleResolution` `bundler` and `nodenext`.
- Runtime dependency: `@convex-dev/aggregate` `^0.3.4`, mounted inside this
  component automatically; you do not `app.use` it yourself.
- `@vllnt/convex-notifications/test` ships as TypeScript source. It needs
  `convex-test`, `vitest`, `vite` (for `import.meta.glob` and the `vite/client`
  types) and `@edge-runtime/vm`, with the Vitest config shown under Testing.
- React: not applicable. The package is backend-only and has no `./react` entry.

## Testing

Mount the component in your own `convex-test` suite with `register`. Use the
Vitest settings `convex-test` recommends (edge runtime, `convex-test` inlined):

```ts
// vitest.config.mts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
  },
});
```

`register` works with any host schema, including one with its own tables:

```ts
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  prefs: defineTable({ subjectRef: v.string(), channel: v.string() }),
});
```

```ts
// convex/inbox.test.ts
/// <reference types="vite/client" />
import { register } from "@vllnt/convex-notifications/test";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

test("a mention reaches the recipient's inbox", async () => {
  const t = convexTest(schema, import.meta.glob("./**/*.ts"));
  register(t);
  const ids = await t.mutation(internal.inbox.notifyMention, {
    recipients: ["user-1"],
    actor: "user-9",
  });
  const user = t.withIdentity({ tokenIdentifier: "user-1" });
  expect(await user.query(api.inbox.myUnreadCount, {})).toBe(1);
  for (const notificationId of ids) {
    await user.mutation(api.inbox.markRead, { notificationId });
  }
  expect(await user.query(api.inbox.myUnreadCount, {})).toBe(0);
  const code = await t.mutation(internal.announce.announce, {
    recipients: [],
    type: "news",
  });
  expect(code).toBe("EMPTY_FANOUT");
});
```

`register(t, name)` takes the mount name when you used
`app.use(notifications, { name })`. It also mounts the nested aggregate
component.

This repository's own tests use the simulated `convex-test` runtime
(`pnpm test:coverage`, 100% coverage enforced).

## Security

- The component does not authenticate. The host must authorize every call and
  derive `subjectRef` itself; never accept a recipient ref from the client.
- Its tables are reachable only through the component's functions; it never
  reads or writes host tables.
- `subjectRef`, `type` and `payload` are opaque to the component. It stores them
  as given and checks only that `subjectRef` and `type` are non-empty.

Report vulnerabilities as described in
[SECURITY.md](https://github.com/vllnt/convex-notifications/blob/main/SECURITY.md).

## Related packages

- `@convex-dev/aggregate` ([npm](https://www.npmjs.com/package/@convex-dev/aggregate)):
  runtime dependency; this component nests it to keep each recipient's unread
  count.

No @vllnt package works with this one in code (no dependency, shared test or
example).

## Contributing

See
[CONTRIBUTING.md](https://github.com/vllnt/convex-notifications/blob/main/CONTRIBUTING.md).

## Links

- Docs and changelog: [oss.vllnt.com/packages/convex-notifications](https://oss.vllnt.com/packages/convex-notifications) · [release feed](https://oss.vllnt.com/packages/convex-notifications/rss.xml)
- All @vllnt packages: [oss.vllnt.com](https://oss.vllnt.com) · [search packages and docs on index.vllnt.com](https://index.vllnt.com)
- Source and issues: [GitHub](https://github.com/vllnt/convex-notifications) · [issues](https://github.com/vllnt/convex-notifications/issues) · [npm](https://www.npmjs.com/package/@vllnt/convex-notifications)
- Questions and updates: [Discord](https://bntvllnt.com/discord) · [X @bntvllnt](https://x.com/bntvllnt)
- Company and author: [vllnt.com](https://vllnt.com) · [bntvllnt.com](https://bntvllnt.com) · [GitHub @bntvllnt](https://github.com/bntvllnt) · [LinkedIn](https://linkedin.com/in/bntvllnt)
- Sponsor: [GitHub Sponsors](https://github.com/sponsors/bntvllnt)

## License

MIT. See [LICENSE](LICENSE).

[![npm](https://img.shields.io/npm/v/@vllnt/convex-notifications.svg)](https://www.npmjs.com/package/@vllnt/convex-notifications)
[![CI](https://github.com/vllnt/convex-notifications/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-notifications/actions/workflows/ci.yml)

---

Part of [vllnt open source](https://oss.vllnt.com) · [Package page](https://oss.vllnt.com/packages/convex-notifications) · [vllnt.com](https://vllnt.com) · Built by [bntvllnt](https://bntvllnt.com)
