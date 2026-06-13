# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-06-14

### Added

- First release of `@vllnt/convex-notifications` — a per-subject directed inbox
  with read/unread state and fan-out.
- `deliver(subjectRef | subjectRefs[], type, payload?)` fans one notification out
  to each recipient, minting a `notificationId` per row and inserting it unread;
  rejects an empty fan-out (`EMPTY_FANOUT`) and one over `maxFanOut`
  (`FANOUT_TOO_LARGE`).
- `markRead(notificationId)` marks one notification read (idempotent), stamping
  `readAt`; `markAllRead(subjectRef)` marks a subject's whole unread inbox in
  bounded, self-rescheduling batches.
- `get(notificationId)` returns the current notification (or `null`);
  `list(subjectRef, paginationOpts, { unreadOnly? })` pages a subject's inbox
  newest-first via the standard Convex pagination envelope; `unreadCount(subjectRef)`
  returns the unread total.
- Subject-bounded reads: a `list`/`unreadCount` for one subject never spans
  another subject's rows (the indexes are subject-keyed).
- Server-sourced time: every handler stamps `createdAt`/`readAt` from `Date.now()`
  inside the mutation — no caller-supplied clock.
- Typed generics: `Notifications<TPayload>` with an optional `payloadValidator`
  host parser narrowing the opaque stored `payload` at the client boundary on
  write and read — no `v.any()` dump, no unchecked cast.
- Bounded, self-rescheduling `purge` (`take(batch)` + scheduler) that removes only
  **read** notifications past their `createdAt` cutoff, plus a built-in daily purge
  cron (`crons.ts`); unread notifications are never purged. Default retention 30
  days.
- Mount-safe: correct under multiple `app.use(component, { name })` mounts — each
  instance is sandboxed, the cron is registered per instance.
