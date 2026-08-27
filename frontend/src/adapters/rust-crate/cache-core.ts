import * as Utils from "@/utils/version-group";

import type { CrateMetadata } from "./metadata";

/** Cached metadata for a single crate. The frontend owns the upstream
 * formats; the host only provides transparent HTTP caching. */
export interface CrateCache {
    name: string;
    versions: { num: string; yanked: boolean }[];
    versionGroups: { versions: { num: string; yanked: boolean }[] }[];
    homepage: string | null;
    repository: string | null;
}

/** Lifecycle of an intent-driven metadata request. An entry can retain
 * usable `data` while reporting an error from a later explicit refresh. */
export interface CrateCacheEntry {
    data: CrateCache | null;
    status: "idle" | "loading" | "ready" | "error";
    error: string | null;
}

/** Mutable state owned by the Svelte-facing cache module. Keeping the request
 * coordinator independent of Svelte runes makes its race handling testable. */
export interface RustCrateCacheState {
    crates: Record<string, CrateCacheEntry>;
}

/** Fetch one normalized metadata document.
 *
 * `refresh` requests the richer, cache-bypassing crates.io representation. */
export type FetchCrateMetadata =
    (name: string, refresh: boolean) => Promise<CrateMetadata>;

/** Resolve one user-entered crate identifier through crates.io. */
export type ResolveCrateMetadata =
    (requestedName: string) => Promise<CrateMetadata>;

/** Coordinate lazy per-crate requests without coupling the request lifecycle
 * to Svelte. The caller supplies a reactive state object in production and a
 * plain object in tests.
 *
 * Concurrent normal loads and repeated refreshes are deduplicated. A refresh
 * may supersede an older normal load; monotonically increasing generations
 * ensure that the older response cannot overwrite the newer result. */
export class CrateCacheLoader {
    readonly #state: RustCrateCacheState;
    readonly #fetchMetadata: FetchCrateMetadata;
    readonly #reportError: (message: string, error: unknown) => void;
    readonly #notifyChange: () => void;
    readonly #inFlight = new Map<
        string,
        { refresh: boolean; promise: Promise<void> }
    >();
    readonly #generations = new Map<string, number>();

    constructor(
        state: RustCrateCacheState,
        fetchMetadata: FetchCrateMetadata,
        reportError: (message: string, error: unknown) => void =
            (message, error) => console.error(message, error),
        notifyChange: () => void = () => {}) {
        this.#state = state;
        this.#fetchMetadata = fetchMetadata;
        this.#reportError = reportError;
        this.#notifyChange = notifyChange;
    }

    /** Return the current entry without creating one. */
    get(name: string): CrateCacheEntry | undefined {
        return this.#state.crates[name];
    }

    /** Load metadata only when no usable cached value exists.
     *
     * Failures are represented in `state` and intentionally do not reject,
     * preventing fire-and-forget UI callers from producing unhandled promise
     * rejections. Calling this method again after an error retries the load. */
    ensure(name: string): Promise<void> {
        if (this.#state.crates[name]?.data) return Promise.resolve();
        const active = this.#inFlight.get(name);
        if (active) return active.promise;
        return this.#start(name, false);
    }

    /** Fetch fresh crates.io metadata while retaining any usable old value.
     *
     * A refresh supersedes an older normal sparse-index request. Repeated
     * refresh calls share one promise so double activation cannot fan out. */
    refresh(name: string): Promise<void> {
        const active = this.#inFlight.get(name);
        if (active?.refresh) return active.promise;
        return this.#start(name, true);
    }

    /** Store an authoritative crates.io response under its canonical name.
     * Priming advances the generation so an older sparse-index request cannot
     * overwrite the canonical record after registry resolution completes. */
    prime(metadata: CrateMetadata): CrateCache {
        const name = metadata.name;
        this.#generations.set(name, (this.#generations.get(name) ?? 0) + 1);
        const data = crateMetadataToCache(metadata);
        this.#state.crates[name] = {
            data,
            status: "ready",
            error: null,
        };
        this.#notifyChange();
        return data;
    }

    /** Start a request and commit its result only if it is still the newest
     * generation for this crate. */
    #start(name: string, refresh: boolean): Promise<void> {
        const generation = (this.#generations.get(name) ?? 0) + 1;
        this.#generations.set(name, generation);

        const previous = this.#state.crates[name];
        this.#state.crates[name] = {
            data: previous?.data ?? null,
            status: "loading",
            error: null,
        };
        this.#notifyChange();

        const promise = this.#fetchMetadata(name, refresh)
            .then(metadata => {
                if (this.#generations.get(name) !== generation) return;
                this.#state.crates[name] = {
                    data: crateMetadataToCache(metadata),
                    status: "ready",
                    error: null,
                };
                this.#notifyChange();
            })
            .catch(error => {
                if (this.#generations.get(name) !== generation) return;
                const current = this.#state.crates[name];
                this.#state.crates[name] = {
                    data: current?.data ?? null,
                    status: "error",
                    error: error instanceof Error ? error.message : String(error),
                };
                this.#notifyChange();
                this.#reportError(`Failed to fetch crate metadata for ${name}:`, error);
            })
            .finally(() => {
                if (this.#inFlight.get(name)?.promise === promise)
                    this.#inFlight.delete(name);
            });
        this.#inFlight.set(name, { refresh, promise });
        return promise;
    }
}

/** Deduplicate registry lookups for user-entered identifiers and prime the
 * shared cache under crates.io's canonical name. Unlike lazy selector loads,
 * resolution failures reject so callers can keep invalid crates unpersisted. */
export class CrateCacheResolver {
    readonly #cacheLoader: CrateCacheLoader;
    readonly #resolveMetadata: ResolveCrateMetadata;
    readonly #inFlight = new Map<string, Promise<CrateCache>>();

    constructor(
        cacheLoader: CrateCacheLoader,
        resolveMetadata: ResolveCrateMetadata) {
        this.#cacheLoader = cacheLoader;
        this.#resolveMetadata = resolveMetadata;
    }

    /** Resolve an identifier once while a matching request is active. Failed
     * requests are removed so a later explicit activation can retry. */
    resolve(requestedName: string): Promise<CrateCache> {
        const active = this.#inFlight.get(requestedName);
        if (active) return active;

        const promise = this.#resolveMetadata(requestedName)
            .then(metadata => this.#cacheLoader.prime(metadata))
            .finally(() => {
                if (this.#inFlight.get(requestedName) === promise)
                    this.#inFlight.delete(requestedName);
            });
        this.#inFlight.set(requestedName, promise);
        return promise;
    }
}

/** Precompute the semver groups once per successful response so reactive
 * renders only perform cheap cache lookups. */
function crateMetadataToCache(meta: CrateMetadata): CrateCache {
    return {
        name: meta.name,
        versions: meta.versions,
        versionGroups: Utils.computeVersionGroups(meta.versions),
        repository: meta.repository,
        homepage: meta.homepage,
    };
}
