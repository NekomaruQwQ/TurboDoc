import * as z from "zod";

/** Schema for a single cached crate from crates.io. */
export const crateCacheSchema = z.object({
    /** Timestamp when this cache entry was last updated. */
    lastFetched: z.number(),
    /** Name of the crate (for validation). */
    name: z.string(),
    /** Full version list fetched from crates.io API. */
    versions: z.array(z.object({
        num: z.string(),
        yanked: z.boolean(),
    })),
    /** Grouped versions for display. */
    versionGroups: z.array(z.object({
        versions: z.array(z.object({
            num: z.string(),
            yanked: z.boolean(),
        })),
    })),
    /** Homepage URL. */
    homepage: z.string().nullable(),
    /** Repository URL. */
    repository: z.string().nullable(),
    /** Documentation URL (might differ from docs.rs). */
    documentation: z.string().nullable(),
});

/** Schema for the Rust provider's entire cache. */
export const rustCacheSchema = z.object({
    crates: z.record(z.string(), crateCacheSchema),
});

export type CrateCache = z.infer<typeof crateCacheSchema>;
export type RustProviderCache = z.infer<typeof rustCacheSchema>;
