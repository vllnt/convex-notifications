import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  PaginationOptions,
  PaginationResult,
} from "convex/server";
import type {
  ListOptions,
  NotificationsOptions,
  NotificationView,
  Parser,
} from "./types.js";
import { DEFAULT_MAX_FANOUT, DEFAULT_PURGE_BATCH } from "../shared.js";

/**
 * The component's raw notification view, before the client narrows opaque host
 * data. `payload` is `unknown` here; the {@link Notifications} client runs the
 * host validator over it at its typed boundary.
 */
type RawView = {
  notificationId: string;
  subjectRef: string;
  type: string;
  payload?: unknown;
  readAt?: number;
  createdAt: number;
};

/**
 * The notifications component's function references, as exposed on the host via
 * `components.notifications`. The host's stored `payload` is opaque here
 * (`unknown`); the {@link Notifications} client narrows it at its own typed
 * boundary.
 */
export interface NotificationsComponent {
  mutations: {
    deliver: FunctionReference<
      "mutation",
      "internal",
      {
        subjectRefs: string[];
        type: string;
        payload?: unknown;
        maxFanOut: number;
      },
      { notificationIds: string[] }
    >;
    markRead: FunctionReference<
      "mutation",
      "internal",
      { notificationId: string },
      null
    >;
    markAllRead: FunctionReference<
      "mutation",
      "internal",
      { subjectRef: string; batch: number },
      number
    >;
    purge: FunctionReference<
      "mutation",
      "internal",
      { before?: number; batch: number },
      number
    >;
  };
  queries: {
    get: FunctionReference<
      "query",
      "internal",
      { notificationId: string },
      RawView | null
    >;
    list: FunctionReference<
      "query",
      "internal",
      {
        subjectRef: string;
        unreadOnly: boolean;
        paginationOpts: PaginationOptions;
      },
      PaginationResult<RawView>
    >;
    unreadCount: FunctionReference<
      "query",
      "internal",
      { subjectRef: string },
      number
    >;
  };
}

interface RunQueryCtx {
  runQuery<Q extends FunctionReference<"query", "internal">>(
    reference: Q,
    args: FunctionArgs<Q>,
  ): Promise<FunctionReturnType<Q>>;
}

interface RunMutationCtx {
  runMutation<M extends FunctionReference<"mutation", "internal">>(
    reference: M,
    args: FunctionArgs<M>,
  ): Promise<FunctionReturnType<M>>;
}

/**
 * Consumer-facing client for a per-subject directed inbox. A host mutation
 * delivers a notification to one or many opaque `subjectRef`s (fan-out); the
 * recipient's UI lists their inbox (all or unread-only, paginated, reactively in
 * Convex), reads the unread count, and marks notifications read. The host owns
 * meaning and auth — it resolves identity, decides who may deliver or read, and
 * passes opaque `subjectRef`s, a `type` tag, and arbitrary `payload` data the
 * component stores without inspecting. Pass `payloadValidator` to narrow that
 * opaque data to `TPayload` at the boundary — there is no unchecked cast.
 *
 * @typeParam TPayload - The host's notification payload type (defaults to `unknown`).
 *
 * @example
 * ```ts
 * const inbox = new Notifications(components.notifications, {
 *   payloadValidator: v.object({ actor: v.string() }).parse,
 * });
 * const { notificationIds } = await inbox.deliver(ctx, ["u1", "u2"], "mention", { actor: "u9" });
 * const count = await inbox.unreadCount(ctx, "u1");          // 1
 * const page = await inbox.list(ctx, "u1", { cursor: null, numItems: 20 }, { unreadOnly: true });
 * await inbox.markRead(ctx, notificationIds[0]);
 * ```
 */
export class Notifications<TPayload = unknown> {
  private readonly payloadValidator: Parser<TPayload> | undefined;
  private readonly maxFanOut: number;

  constructor(
    private readonly component: NotificationsComponent,
    options: NotificationsOptions<TPayload> = {},
  ) {
    this.payloadValidator = options.payloadValidator;
    this.maxFanOut = options.maxFanOut ?? DEFAULT_MAX_FANOUT;
  }

  /** Narrow an opaque value through a host parser; pass `undefined` and unset parsers through. */
  private parse(value: unknown): TPayload | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (this.payloadValidator === undefined) {
      return value as TPayload;
    }
    return this.payloadValidator(value);
  }

  /** Project a raw component view into the typed, validated client view. */
  private view(raw: RawView): NotificationView<TPayload> {
    return {
      notificationId: raw.notificationId,
      subjectRef: raw.subjectRef,
      type: raw.type,
      payload: this.parse(raw.payload),
      readAt: raw.readAt,
      createdAt: raw.createdAt,
    };
  }

  /**
   * Deliver one notification to each recipient — the fan-out. `subjects` is a
   * single opaque `subjectRef` or an array of them; `type` tags the
   * notification; `payload` is opaque host data validated against
   * `payloadValidator` before storage. Returns one minted `notificationId` per
   * recipient, in order. Rejects an empty or over-`maxFanOut` recipient set.
   */
  async deliver(
    ctx: RunMutationCtx,
    subjects: string | string[],
    type: string,
    payload?: TPayload,
  ): Promise<{ notificationIds: string[] }> {
    const subjectRefs = Array.isArray(subjects) ? subjects : [subjects];
    return ctx.runMutation(this.component.mutations.deliver, {
      subjectRefs,
      type,
      payload: payload === undefined ? undefined : this.parse(payload),
      maxFanOut: this.maxFanOut,
    });
  }

  /** Mark one notification read (idempotent). Rejects a missing id (`NOT_FOUND`). */
  markRead(ctx: RunMutationCtx, notificationId: string): Promise<null> {
    return ctx.runMutation(this.component.mutations.markRead, {
      notificationId,
    });
  }

  /**
   * Mark every unread notification for `subjectRef` read, in bounded batches
   * (the component self-reschedules until the tail is clean). Returns the count
   * marked in the first pass.
   */
  markAllRead(
    ctx: RunMutationCtx,
    subjectRef: string,
    opts: { batch?: number } = {},
  ): Promise<number> {
    return ctx.runMutation(this.component.mutations.markAllRead, {
      subjectRef,
      batch: opts.batch ?? DEFAULT_PURGE_BATCH,
    });
  }

  /** The current notification for `notificationId`, or `null` if none is held. */
  async get(
    ctx: RunQueryCtx,
    notificationId: string,
  ): Promise<NotificationView<TPayload> | null> {
    const raw = await ctx.runQuery(this.component.queries.get, {
      notificationId,
    });
    return raw === null ? null : this.view(raw);
  }

  /**
   * Page a subject's inbox, newest first. Pass `{ unreadOnly: true }` to page
   * only unread notifications. Returns the standard Convex pagination envelope
   * with each row narrowed to the typed view.
   */
  async list(
    ctx: RunQueryCtx,
    subjectRef: string,
    paginationOpts: PaginationOptions,
    opts: ListOptions = {},
  ): Promise<PaginationResult<NotificationView<TPayload>>> {
    const result = await ctx.runQuery(this.component.queries.list, {
      subjectRef,
      unreadOnly: opts.unreadOnly ?? false,
      paginationOpts,
    });
    return { ...result, page: result.page.map((raw) => this.view(raw)) };
  }

  /** The number of unread notifications for `subjectRef`. */
  unreadCount(ctx: RunQueryCtx, subjectRef: string): Promise<number> {
    return ctx.runQuery(this.component.queries.unreadCount, { subjectRef });
  }

  /**
   * Delete read notifications whose `createdAt < before` in bounded batches,
   * oldest first. `before` defaults to the server clock; `batch` caps each pass
   * and the sweep self-reschedules until the read tail is clean. Returns the
   * count removed in the first pass. Unread notifications are never purged. The
   * built-in daily cron drives this automatically.
   */
  purge(
    ctx: RunMutationCtx,
    opts: { before?: number; batch?: number } = {},
  ): Promise<number> {
    return ctx.runMutation(this.component.mutations.purge, {
      before: opts.before,
      batch: opts.batch ?? DEFAULT_PURGE_BATCH,
    });
  }
}

export type {
  ListOptions,
  NotificationsOptions,
  NotificationView,
  Parser,
};
