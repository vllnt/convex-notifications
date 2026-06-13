import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { register } from "../../src/test";
import crons, {
  PURGE_BATCH,
  PURGE_INTERVAL,
} from "../../src/component/crons";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  register(t); // default "notifications" mount
  register(t, "alerts"); // second named mount — proves mount-safety
  return t;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("notifications — deliver + read (the directed inbox)", () => {
  test("deliver to one subject, then read it, walks the lifecycle", async () => {
    const t = setup();
    const { notificationIds } = await t.mutation(api.example.deliverOne, {
      subjectRef: "u1",
      type: "mention",
      payload: { actor: "u9" },
    });
    expect(notificationIds).toHaveLength(1);
    const id = notificationIds[0];

    const unread = await t.query(api.example.get, { notificationId: id });
    expect(unread?.subjectRef).toBe("u1");
    expect(unread?.type).toBe("mention");
    expect(unread?.payload).toEqual({ actor: "u9" });
    expect(unread?.readAt).toBeUndefined();
    expect(unread?.createdAt).toBe(0);
    expect(await t.query(api.example.unreadCount, { subjectRef: "u1" })).toBe(1);

    vi.setSystemTime(1_000);
    await t.mutation(api.example.markRead, { notificationId: id });
    const read = await t.query(api.example.get, { notificationId: id });
    expect(read?.readAt).toBe(1_000);
    expect(await t.query(api.example.unreadCount, { subjectRef: "u1" })).toBe(0);
  });

  test("deliver with no payload records an undefined payload", async () => {
    const t = setup();
    const { notificationIds } = await t.mutation(api.example.deliverOne, {
      subjectRef: "u1",
      type: "ping",
    });
    const n = await t.query(api.example.get, {
      notificationId: notificationIds[0],
    });
    expect(n?.payload).toBeUndefined();
  });

  test("markRead is idempotent — re-reading does not churn readAt", async () => {
    const t = setup();
    const { notificationIds } = await t.mutation(api.example.deliverOne, {
      subjectRef: "u1",
      type: "t",
    });
    const id = notificationIds[0];
    await t.mutation(api.example.markRead, { notificationId: id });
    vi.setSystemTime(500);
    await t.mutation(api.example.markRead, { notificationId: id });
    const n = await t.query(api.example.get, { notificationId: id });
    expect(n?.readAt).toBe(0); // second markRead was a no-op
  });
});

describe("notifications — fan-out", () => {
  test("deliver fans out one notification per recipient", async () => {
    const t = setup();
    const { notificationIds } = await t.mutation(api.example.deliver, {
      subjectRefs: ["a", "b", "c"],
      type: "broadcast",
      payload: "hello",
    });
    expect(notificationIds).toHaveLength(3);
    expect(new Set(notificationIds).size).toBe(3); // distinct ids
    expect(await t.query(api.example.unreadCount, { subjectRef: "a" })).toBe(1);
    expect(await t.query(api.example.unreadCount, { subjectRef: "b" })).toBe(1);
    expect(await t.query(api.example.unreadCount, { subjectRef: "c" })).toBe(1);
  });

  test("an empty fan-out is rejected", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.deliver, { subjectRefs: [], type: "t" }),
    ).rejects.toThrow(/at least one subjectRef/);
  });

  test("a fan-out over the cap is rejected (strict client maxFanOut=2)", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.deliverStrict, {
        subjectRefs: ["a", "b", "c"],
        payload: { actor: "x" },
      }),
    ).rejects.toThrow(/exceeds maxFanOut/);
    // nothing landed
    expect(await t.query(api.example.unreadCount, { subjectRef: "a" })).toBe(0);
  });
});

describe("notifications — adversarial", () => {
  test("get on a missing id returns null", async () => {
    const t = setup();
    expect(
      await t.query(api.example.get, { notificationId: "ghost" }),
    ).toBeNull();
  });

  test("markRead on a missing id throws NOT_FOUND", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.markRead, { notificationId: "ghost" }),
    ).rejects.toThrow(/not found/);
  });

  test("list for a subject with no notifications returns an empty done page", async () => {
    const t = setup();
    const r = await t.query(api.example.list, {
      subjectRef: "nobody",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(r.page).toEqual([]);
    expect(r.isDone).toBe(true);
  });

  test("unreadCount for a subject with none is 0", async () => {
    const t = setup();
    expect(
      await t.query(api.example.unreadCount, { subjectRef: "nobody" }),
    ).toBe(0);
  });
});

describe("notifications — concurrency", () => {
  test("two readers marking the same notification yield a consistent read", async () => {
    const t = setup();
    const { notificationIds } = await t.mutation(api.example.deliverOne, {
      subjectRef: "u1",
      type: "t",
    });
    const id = notificationIds[0];
    const results = await Promise.allSettled([
      t.mutation(api.example.markRead, { notificationId: id }),
      t.mutation(api.example.markRead, { notificationId: id }),
    ]);
    // both calls succeed (idempotent), and the notification ends up read once
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await t.query(api.example.unreadCount, { subjectRef: "u1" })).toBe(0);
  });
});

describe("notifications — list (paginated, newest first, unread filter)", () => {
  test("lists a subject's inbox newest first; unreadOnly hides read", async () => {
    const t = setup();
    await t.mutation(api.example.deliverOne, { subjectRef: "u1", type: "t1" });
    vi.setSystemTime(10);
    const second = await t.mutation(api.example.deliverOne, {
      subjectRef: "u1",
      type: "t2",
    });
    vi.setSystemTime(20);
    await t.mutation(api.example.deliverOne, { subjectRef: "u1", type: "t3" });
    // read the middle one
    await t.mutation(api.example.markRead, {
      notificationId: second.notificationIds[0],
    });

    const all = await t.query(api.example.list, {
      subjectRef: "u1",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(all.page.map((n) => n.type)).toEqual(["t3", "t2", "t1"]);

    const unread = await t.query(api.example.list, {
      subjectRef: "u1",
      unreadOnly: true,
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(unread.page.map((n) => n.type)).toEqual(["t3", "t1"]);
  });

  test("respects the page size and returns a continue cursor", async () => {
    const t = setup();
    for (let i = 0; i < 3; i++) {
      vi.setSystemTime(i);
      await t.mutation(api.example.deliverOne, { subjectRef: "u1", type: `t${i}` });
    }
    const first = await t.query(api.example.list, {
      subjectRef: "u1",
      paginationOpts: { cursor: null, numItems: 2 },
    });
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);
    const second = await t.query(api.example.list, {
      subjectRef: "u1",
      paginationOpts: { cursor: first.continueCursor, numItems: 2 },
    });
    expect(second.page).toHaveLength(1);
    expect(second.isDone).toBe(true);
  });

  test("a subject's list never spans another subject's rows", async () => {
    const t = setup();
    await t.mutation(api.example.deliverOne, { subjectRef: "u1", type: "mine" });
    await t.mutation(api.example.deliverOne, { subjectRef: "u2", type: "theirs" });
    const u1 = await t.query(api.example.list, {
      subjectRef: "u1",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(u1.page.map((n) => n.type)).toEqual(["mine"]);
  });
});

describe("notifications — markAllRead", () => {
  test("marks every unread for one subject and leaves others alone", async () => {
    const t = setup();
    await t.mutation(api.example.deliver, {
      subjectRefs: ["u1", "u1", "u1"],
      type: "t",
    });
    await t.mutation(api.example.deliverOne, { subjectRef: "u2", type: "t" });
    expect(await t.query(api.example.unreadCount, { subjectRef: "u1" })).toBe(3);

    vi.setSystemTime(1_000);
    const marked = await t.mutation(api.example.markAllRead, {
      subjectRef: "u1",
    });
    expect(marked).toBe(3);
    expect(await t.query(api.example.unreadCount, { subjectRef: "u1" })).toBe(0);
    // a shared readAt stamp from the one server-clock read
    const page = await t.query(api.example.list, {
      subjectRef: "u1",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(page.page.every((n) => n.readAt === 1_000)).toBe(true);
    // u2 is untouched
    expect(await t.query(api.example.unreadCount, { subjectRef: "u2" })).toBe(1);
  });

  test("markAllRead on an empty unread inbox marks nothing", async () => {
    const t = setup();
    expect(
      await t.mutation(api.example.markAllRead, { subjectRef: "nobody" }),
    ).toBe(0);
  });

  test("markAllRead above the batch self-reschedules and clears the whole tail", async () => {
    const t = setup();
    const refs = Array.from({ length: 5 }, () => "u1");
    await t.mutation(api.example.deliver, { subjectRefs: refs, type: "t" });
    const firstPass = await t.mutation(api.example.markAllRead, {
      subjectRef: "u1",
      batch: 2,
    });
    expect(firstPass).toBe(2);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.query(api.example.unreadCount, { subjectRef: "u1" })).toBe(0);
  });
});

describe("notifications — payload validator (strict client)", () => {
  test("a valid payload round-trips through the strict client", async () => {
    const t = setup();
    const { notificationIds } = await t.mutation(api.example.deliverStrict, {
      subjectRefs: ["u1"],
      payload: { actor: "u9" },
    });
    const n = await t.query(api.example.getStrict, {
      notificationId: notificationIds[0],
    });
    expect(n?.payload).toEqual({ actor: "u9" });
  });

  test("a payload failing the host validator is rejected before storage", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.deliverStrict, {
        subjectRefs: ["u1"],
        payload: { actor: 123 },
      }),
    ).rejects.toThrow(/invalid payload/);
    expect(await t.query(api.example.unreadCount, { subjectRef: "u1" })).toBe(0);
  });
});

describe("notifications — mount-safety (independent named mount)", () => {
  test("the same subjectRef in two mounts is independent", async () => {
    const t = setup();
    await t.mutation(api.example.deliverOne, { subjectRef: "shared", type: "main" });
    await t.mutation(api.example.deliverAlert, {
      subjectRef: "shared",
      type: "alert",
    });
    expect(await t.query(api.example.unreadCount, { subjectRef: "shared" })).toBe(
      1,
    );
    expect(
      await t.query(api.example.unreadCountAlert, { subjectRef: "shared" }),
    ).toBe(1);
    expect(await t.mutation(api.example.purgeAlert, {})).toBe(0);
  });
});

describe("notifications — purge (bounded + self-rescheduling)", () => {
  test("purges only read notifications past the cutoff", async () => {
    const t = setup();
    // read + old
    const oldRead = await t.mutation(api.example.deliverOne, {
      subjectRef: "u1",
      type: "old",
    });
    await t.mutation(api.example.markRead, {
      notificationId: oldRead.notificationIds[0],
    });
    // unread + old (never purged)
    await t.mutation(api.example.deliverOne, { subjectRef: "u1", type: "unread" });
    // read but fresh (after the cutoff)
    vi.setSystemTime(1_000);
    const fresh = await t.mutation(api.example.deliverOne, {
      subjectRef: "u1",
      type: "fresh",
    });
    await t.mutation(api.example.markRead, {
      notificationId: fresh.notificationIds[0],
    });

    const removed = await t.mutation(api.example.purge, {
      before: 100,
      batch: 200,
    });
    expect(removed).toBe(1);
    expect(
      await t.query(api.example.get, {
        notificationId: oldRead.notificationIds[0],
      }),
    ).toBeNull();
    // unread + fresh survive
    expect(await t.query(api.example.unreadCount, { subjectRef: "u1" })).toBe(1);
    expect(
      await t.query(api.example.get, {
        notificationId: fresh.notificationIds[0],
      }),
    ).not.toBeNull();
  });

  test("purge with no cutoff defaults to server now", async () => {
    const t = setup();
    const d = await t.mutation(api.example.deliverOne, {
      subjectRef: "u1",
      type: "t",
    });
    await t.mutation(api.example.markRead, {
      notificationId: d.notificationIds[0],
    });
    vi.setSystemTime(1_000);
    expect(await t.mutation(api.example.purge, {})).toBe(1);
  });

  test("purge on an empty table returns 0", async () => {
    const t = setup();
    expect(
      await t.mutation(api.example.purge, { before: 9_999_999, batch: 200 }),
    ).toBe(0);
  });

  test("purge above the batch size self-reschedules and clears the whole tail", async () => {
    const t = setup();
    for (let i = 0; i < 5; i++) {
      const d = await t.mutation(api.example.deliverOne, {
        subjectRef: "u1",
        type: "t",
      });
      await t.mutation(api.example.markRead, {
        notificationId: d.notificationIds[0],
      });
    }
    vi.setSystemTime(1_000);
    const firstPass = await t.mutation(api.example.purge, {
      before: 1_000,
      batch: 2,
    });
    expect(firstPass).toBe(2);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    // every read row is gone; the table holds no read rows
    const r = await t.query(api.example.list, {
      subjectRef: "u1",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(r.page).toEqual([]);
  });
});

describe("notifications — built-in purge cron", () => {
  test("registers a daily self-rescheduling purge job with the default page size", () => {
    expect(PURGE_INTERVAL).toEqual({ hours: 24 });
    expect(PURGE_BATCH).toBe(200);
    expect(Object.keys(crons.crons)).toContain("notifications:purge");
    const job = crons.crons["notifications:purge"];
    expect(job?.name).toBe("mutations:purge");
    expect(job?.args).toEqual([{ batch: 200 }]);
  });
});

describe("notifications — host/component table isolation", () => {
  test("a host pref lives in the host table, separate from the component", async () => {
    const t = setup();
    await t.mutation(api.example.deliverOne, { subjectRef: "u1", type: "t" });
    await t.mutation(api.example.setPref, {
      subjectRef: "u1",
      channel: "email",
    });
    // the host pref is readable from the host table
    expect(await t.query(api.example.getPref, { subjectRef: "u1" })).toBe("email");
    // the component inbox is unaffected
    expect(await t.query(api.example.unreadCount, { subjectRef: "u1" })).toBe(1);
    // a pref for a subject with no notifications is fine — fully decoupled
    await t.mutation(api.example.setPref, { subjectRef: "orphan", channel: "push" });
    expect(await t.query(api.example.getPref, { subjectRef: "orphan" })).toBe(
      "push",
    );
    expect(
      await t.query(api.example.unreadCount, { subjectRef: "orphan" }),
    ).toBe(0);
  });
});
