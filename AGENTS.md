<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `example/convex/_generated/ai/guidelines.md` first** for
important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

# @vllnt/convex-notifications

A per-subject directed inbox — notifications with read/unread state and fan-out, as a Convex
component. A host mutation delivers a notification to one or many opaque `subjectRef`s; each
recipient's UI lists their inbox (all or unread-only, paginated), reads the unread count, and marks
notifications read. It follows the vllnt Component Standard (see the `convex-components` hub
`.claude/rules/component-standard.md`).

## Architecture

```
src/
├── shared.ts              # constants: component name, retention, purge batch, fan-out cap
├── test.ts                # convex-test register() helper
├── client/
│   ├── index.ts           # Notifications<TPayload> class (consumer-facing API)
│   └── types.ts           # public TypeScript interfaces
└── component/
    ├── schema.ts           # sandboxed table: notifications {notificationId, subjectRef, type, payload?, read, readAt?, createdAt}
    ├── convex.config.ts    # defineComponent("notifications")
    ├── mutations.ts        # deliver, markRead, markAllRead, purge
    ├── queries.ts          # get, list, unreadCount
    ├── validators.ts       # shared validators (notificationView, jsonValue)
    └── crons.ts            # daily purge cron (self-rescheduling)
```

Sandboxed table: `notifications` — indexed `by_notification_id` (lookup / markRead), `by_subject_created` (a
subject's inbox), `by_subject_read_created` (a subject's unread slice + count), and `by_read_created`
(retention sweep). No host tables are touched. The stored `payload` is opaque to the component; the
host narrows it via `payloadValidator` at the client boundary.

## Ownership boundary

**Component owns:**

- The inbox (`notifications` table) — deliver, read-state, fan-out, purge
- Server-sourced time — `Date.now()` inside every handler stamps `createdAt`/`readAt`; no caller clock
- Minting one `notificationId` per delivered row (the host names the recipient, not the row)
- Read/unread state (the derived `read` boolean + `readAt`), idempotent `markRead`
- The fan-out cap (`maxFanOut`) and rejection of an empty fan-out
- The daily purge cron and `purge` mutation (read notifications past retention only)

**Host owns:**

- The recipient (`subjectRef`), the notification's domain meaning (`type`, `payload`), and channels
- Auth and authorization — whether a caller may deliver to or read a given `subjectRef`
- Resolving and namespacing `subjectRef` (an opaque string — a user id, a scoped key)
- Channel fan-out (email/push) — read a notification (or subscribe) and route to `@vllnt/convex-email` / `@convex-dev/expo-push-notifications`
- The stored `payload` type (`TPayload`) — opaque to the component, narrowed by the host validator

**Auth:** the component is completely auth-agnostic. The host resolves identity, decides access, and
passes opaque refs. There is no built-in scope dimension — the host namespaces `subjectRef` itself, or
mounts a second instance (`app.use(component, { name })`) for a static partition.

## Key design decisions

- **Directed inbox, not an activity feed (the core framing):** notifications are *directed at* a
  recipient with unread state (push); a feed is an actor's own timeline (pull). This component owns the
  read-state inbox; channel fan-out (email/push) stays in the host so the component is a pure inbox.

- **Server-sourced time:** every handler stamps `createdAt`/`readAt` from `Date.now()` internally; no
  API surface accepts a caller-supplied timestamp. Ordering and retention cannot be skewed by a client
  clock.

- **Component-minted `notificationId` (fan-out):** because one `deliver` writes a row per recipient,
  the component mints each id (`crypto.randomUUID()`) — the host names the *recipient* (`subjectRef`),
  not the row. `deliver` returns the ids so the host can address a specific notification later.

- **Derived `read` boolean for an indexed unread slice:** `read` is stamped `false` at insert and
  flipped on `markRead`, so unread listing and `unreadCount` ride the `by_subject_read_created` index
  with no post-query `.filter()` (forbidden by lint). `markRead` is idempotent — re-reading never
  churns `readAt`.

- **Subject-bounded reads (no footgun):** `list`/`unreadCount` are keyed on `subjectRef` in the index,
  so a read for one subject can never silently span another subject's inbox.

- **Bounded fan-out (`maxFanOut`):** `deliver` rejects an empty set (`EMPTY_FANOUT`) and one over the
  client's cap (`FANOUT_TOO_LARGE`, default 256) so one mutation never amplifies past the transaction
  write budget; a host fanning out wider batches its own calls.

- **Typed-generic opaque data, never `v.any()` dumped raw:** `payload` rides through the single
  documented `jsonValue` alias and is narrowed to `TPayload` by a host parser at the client boundary on
  both write and read — no unchecked cast.

- **Bounded purge + self-reschedule (read-only):** `purge` removes up to `batch` read notifications
  (default 200) past their `createdAt` cutoff per pass and self-reschedules via `ctx.scheduler` when a
  full batch was removed. Unread notifications are never swept. Idempotent; the built-in daily cron
  drives it automatically. Default retention 30 days. `markAllRead` uses the same bounded
  self-rescheduling pattern.

- **Backend-only (no `./react` entry):** an inbox / unread count / unread list is an ordinary reactive
  `useQuery` over the host's own re-exported `list`/`unreadCount`/`get` refs — a dedicated hook would
  wrap the host's `api` with no added value. Explicit analysis decision (see README); re-run when a real
  management-surface consumer appears.

## Conventions

- Mutations in `mutations.ts`, queries in `queries.ts` (enforced by `@vllnt/eslint-config/convex`).
- Explicit `args` + `returns` on every Convex function.
- Host data via typed generics / host validators — never `v.any()` dumps; `jsonValue` is the documented
  last resort for the stored opaque `payload`.
- 100% test coverage is BLOCKING (`vitest.config.mts` thresholds: statements, branches, functions, lines).
- Runtime deps: only official `@convex-dev/*` + `@vllnt/*`.

## Docs sync

| Changed | Update in the same commit |
|---------|--------------------------|
| Public API (deliver/markRead/markAllRead/get/list/unreadCount/purge signatures) | README API Reference table, `docs/API.md`, `llms.txt` context |
| Config options / defaults (validator, retention, batch, maxFanOut) | README API Reference, `docs/API.md` constructor section |
| Schema / table / indexes | README Architecture, `docs/API.md` |
| Error codes | `docs/API.md` → `## Error codes` table |
| `peerDependencies.convex` version | `llms.txt` context line (`convex@^X.Y.Z`), `docs/API.md` Compatibility line, README Installation peer note |
| Read-state / inbox semantics | `docs/API.md` mutation/query sections, Key design decisions above |

Grep old values before committing (e.g. after a `peerDependencies.convex` bump, `git grep "1.41.0"` → only the new range survives).
