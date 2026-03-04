import type { PartialDeep } from "type-fest";

/** Custom error for rate limiting. */
export class RateLimitError extends Error {
    constructor(public retryAfterSeconds: number) {
        super(`Rate limited. Retry after ${retryAfterSeconds} seconds.`);
        this.name = "RateLimitError";
    }
}

/** Custom error for crate not found. */
export class CrateNotFoundError extends Error {
    constructor(crateName: string) {
        super(`Crate not found: ${crateName}`);
        this.name = "CrateNotFoundError";
    }
}

/** Custom error for malformed responses. */
export class MalformedResponseError extends Error {
    constructor(message: string) {
        super(`Malformed response: ${message}`);
        this.name = "MalformedResponseError";
    }
}

/** Response structure from crates.io API. */
export interface CrateInfo {
    crate: {
        id: string;
        name: string;
        description?: string;
        homepage?: string;
        repository?: string;
        documentation?: string;
    };
    versions: {
        num: string;
        yanked: boolean;
    }[];
}

// Rate limiting is handled at the proxy layer — the server's HTTP cache
// (24h TTL for crates.io API) shields upstream from repeated requests.

/** Fetch crate information from crates.io API. */
export async function fetchCrateInfo(crateName: string): Promise<CrateInfo> {
    function throwMissingField(path: string): never {
        throw new MalformedResponseError(`Missing field ${path}`);
    }

    console.log(`[crates.io] Fetching crate info for ${crateName}.`);
    const upstream = `https://crates.io/api/v1/crates/${crateName}`;
    const response =
        await fetch(`/proxy?url=${encodeURIComponent(upstream)}`);

    if (response.status === 404) {
        throw new CrateNotFoundError(crateName);
    }

    if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        throw new RateLimitError(parseInt(retryAfter || "60", 10));
    }

    if (!response.ok) {
        throw new Error(`Crates.io API error: ${response.status}`);
    }

    const data = await response.json() as PartialDeep<CrateInfo>;
    return {
        crate: {
            id: data.crate?.id
                || throwMissingField("crate.id"),
            name: data.crate?.name
                || throwMissingField("crate.name"),
            description: data.crate?.description,
            homepage: data.crate?.homepage,
            repository: data.crate?.repository,
            documentation: data.crate?.documentation,
        },
        versions:
            data.versions?.map(version => ({
                num: version.num || throwMissingField("versions.num"),
                yanked: version.yanked ?? false,
            })) || throwMissingField("versions"),
    };
}

/** Batch-fetch cached crate metadata from the server's HTTP cache.
 *  Returns a record of crate name → CrateInfo for cache hits.
 *  Cache misses are omitted from the result — the caller should fall back
 *  to individual `fetchCrateInfo()` calls via the proxy for those. */
export async function fetchCratesInfo(
    names: string[],
): Promise<Record<string, CrateInfo>> {
    console.log(`[crates.io] Batch-fetching ${names.length} crates from cache.`);
    const response = await fetch("/api/v1/crates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names }),
    });
    if (!response.ok)
        throw new Error(`Batch crate fetch failed: ${response.status}`);

    const data = await response.json() as Record<string, PartialDeep<CrateInfo> | null>;
    const results: Record<string, CrateInfo> = {};
    for (const [name, info] of Object.entries(data)) {
        // Skip cache misses and entries missing required fields.
        if (!info?.crate?.id || !info.crate.name || !info.versions) continue;
        results[name] = {
            crate: {
                id: info.crate.id,
                name: info.crate.name,
                description: info.crate.description,
                homepage: info.crate.homepage,
                repository: info.crate.repository,
                documentation: info.crate.documentation,
            },
            versions: info.versions
                .filter((v): v is { num: string; yanked: boolean } => !!v?.num)
                .map(v => ({ num: v.num, yanked: v.yanked ?? false })),
        };
    }
    return results;
}

/** Search for crates on crates.io */
export async function searchCrates(query: string): Promise<{ name: string, description: string | null }[]> {
    console.log(`[crates.io] Searching with query "${query}".`);
    const upstream = `https://crates.io/api/v1/crates?q=${encodeURIComponent(query)}`;
    const response = await fetch(`/proxy?url=${encodeURIComponent(upstream)}`);

    if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        throw new RateLimitError(parseInt(retryAfter || "60", 10));
    }

    if (!response.ok) {
        throw new Error(`Crates.io API error: ${response.status}`);
    }

    // biome-ignore lint/suspicious/noExplicitAny: assume valid data from external API.
    return ((await response.json()).crates || []).map((crate: any) => ({
        name: crate.name,
        description: crate.description,
    }));
}
