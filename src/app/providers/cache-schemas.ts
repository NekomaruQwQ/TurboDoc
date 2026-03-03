import type * as z from "zod";

import { rustCacheSchema, type RustProviderCache }
    from "@/app/providers/rust/cache";

/** A cache schema entry: a Zod schema paired with the typed empty default
 *  returned when no cache file exists or when validation fails. */
export interface CacheSchemaEntry<T = unknown> {
    readonly schema: z.ZodType<T>;
    readonly empty: T;
}

/**
 * Registry of cache schemas keyed by provider ID.
 *
 * The server uses this to validate cache data on read/write.
 * The IPC layer uses it for client-side validation as defense-in-depth.
 *
 * Providers without an entry here will have their cache stored and
 * returned without validation (backward-compatible fallback).
 */
export const cacheSchemas: Record<string, CacheSchemaEntry> = {
    rust: {
        schema: rustCacheSchema,
        empty: { crates: {} } satisfies RustProviderCache,
    },
};
