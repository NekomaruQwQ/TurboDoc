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
