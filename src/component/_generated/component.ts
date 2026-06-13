/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    mutations: {
      deliver: FunctionReference<
        "mutation",
        "internal",
        {
          maxFanOut: number;
          payload?: any;
          subjectRefs: Array<string>;
          type: string;
        },
        { notificationIds: Array<string> },
        Name
      >;
      markRead: FunctionReference<
        "mutation",
        "internal",
        { notificationId: string },
        null,
        Name
      >;
      markAllRead: FunctionReference<
        "mutation",
        "internal",
        { batch: number; subjectRef: string },
        number,
        Name
      >;
      purge: FunctionReference<
        "mutation",
        "internal",
        { batch: number; before?: number },
        number,
        Name
      >;
    };
    queries: {
      get: FunctionReference<
        "query",
        "internal",
        { notificationId: string },
        null | {
          createdAt: number;
          notificationId: string;
          payload?: any;
          readAt?: number;
          subjectRef: string;
          type: string;
        },
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          subjectRef: string;
          unreadOnly: boolean;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            createdAt: number;
            notificationId: string;
            payload?: any;
            readAt?: number;
            subjectRef: string;
            type: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
      unreadCount: FunctionReference<
        "query",
        "internal",
        { subjectRef: string },
        number,
        Name
      >;
    };
  };
