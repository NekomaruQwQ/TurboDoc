/** Custom error for rate limiting. */
export class RateLimitError extends Error {
    constructor(public retryAfterSeconds: number) {
        super(`Rate limited. Retry after ${retryAfterSeconds} seconds.`);
        this.name = 'RateLimitError';
    }
}

/** Custom error for crate not found. */
export class CrateNotFoundError extends Error {
    constructor(crateName: string) {
        super(`Crate not found: ${crateName}`);
        this.name = 'CrateNotFoundError';
    }
}

/** Response structure from crates.io API. */
export interface CrateInfo {
    crate: {
        id: string;
        name: string;
        description?: string | null;
        homepage?: string | null;
        repository?: string | null;
        documentation?: string | null;
    };
    versions: {
        num: string;
        yanked: boolean;
    }[];
}

// TODO: When adding rate limiting for additional APIs, extract this into a reusable
// RateLimiter class (e.g., utils/rate-limiter.ts) to avoid code duplication.
// For now, keeping it simple since we only rate-limit crates.io API.

/** Timestamp of the last request made for rate limiting. */
let lastRequest = 0;
/** Minimum delay between requests in milliseconds according to crates.io crawler policy. */
let minDelay = 1000;

/** Queue a request with rate limiting. */
async function queueRequest<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const elapsed = now - lastRequest;

    if (elapsed < minDelay) {
        await new Promise(resolve => setTimeout(resolve, minDelay - elapsed));
    }

    lastRequest = Date.now();
    return fn();
}

/** Fetch crate information from crates.io API. */
export async function fetchCrateInfo(crateName: string): Promise<CrateInfo> {
    return queueRequest(async () => {
        const response =
            await fetch(`https://crates.io/api/v1/crates/${crateName}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
                },
            });

        if (response.status === 404) {
            throw new CrateNotFoundError(crateName);
        }

        if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            throw new RateLimitError(parseInt(retryAfter || '60'));
        }

        if (!response.ok) {
            throw new Error(`Crates.io API error: ${response.status}`);
        }

        return await response.json() as CrateInfo;
    });
}

/** Search for crates on crates.io */
export async function searchCrates(query: string): Promise<{ name: string, description: string | null }[]> {
    return queueRequest(async () => {
        const response = await fetch(
            `https://crates.io/api/v1/crates?q=${encodeURIComponent(query)}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
                },
            });

        if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            throw new RateLimitError(parseInt(retryAfter || '60'));
        }

        if (!response.ok) {
            throw new Error(`Crates.io API error: ${response.status}`);
        }

        return ((await response.json()).crates || []).map((crate: any) => ({
            name: crate.name,
            description: crate.description,
        }));
    });
}
