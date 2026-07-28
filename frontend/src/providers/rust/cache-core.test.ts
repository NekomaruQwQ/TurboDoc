import { describe, expect, test } from "bun:test";

import type { CrateMetadata } from "./metadata";
import {
    CrateCacheLoader,
    type RustProviderCache,
} from "./cache-core";

/** Create a manually settled promise for request-ordering tests. */
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

/** Build the smallest valid normalized metadata response. */
function metadata(version: string): CrateMetadata {
    return {
        name: "tokio",
        versions: [{ num: version, yanked: false }],
        homepage: null,
        repository: null,
    };
}

/** Construct a loader whose diagnostics do not pollute expected-failure
 * test output. */
function createLoader(
    fetchMetadata: (name: string, refresh: boolean) => Promise<CrateMetadata>) {
    const state: RustProviderCache = { crates: {} };
    return {
        state,
        loader: new CrateCacheLoader(state, fetchMetadata, () => {}),
    };
}

describe("CrateCacheLoader", () => {
    test("does no work before explicit intent", () => {
        let calls = 0;
        const { state } = createLoader(async () => {
            calls += 1;
            return metadata("1.0.0");
        });

        expect(calls).toBe(0);
        expect(state.crates).toEqual({});
    });

    test("deduplicates concurrent lazy loads", async () => {
        const request = deferred<CrateMetadata>();
        let calls = 0;
        const { state, loader } = createLoader(() => {
            calls += 1;
            return request.promise;
        });

        const first = loader.ensure("tokio");
        const second = loader.ensure("tokio");

        expect(first).toBe(second);
        expect(calls).toBe(1);
        expect(state.crates.tokio?.status).toBe("loading");

        request.resolve(metadata("1.0.0"));
        await first;
        expect(state.crates.tokio?.status).toBe("ready");
        expect(state.crates.tokio?.data?.versions[0]?.num).toBe("1.0.0");
    });

    test("records failure and retries on later intent", async () => {
        let calls = 0;
        const { state, loader } = createLoader(async () => {
            calls += 1;
            if (calls === 1) throw new Error("offline");
            return metadata("1.1.0");
        });

        await loader.ensure("tokio");
        expect(state.crates.tokio).toMatchObject({
            data: null,
            status: "error",
            error: "offline",
        });

        await loader.ensure("tokio");
        expect(calls).toBe(2);
        expect(state.crates.tokio?.status).toBe("ready");
        expect(state.crates.tokio?.data?.versions[0]?.num).toBe("1.1.0");
    });

    test("keeps usable data when an explicit refresh fails", async () => {
        let refreshRequested = false;
        const { state, loader } = createLoader(async (_name, refresh) => {
            if (refresh) {
                refreshRequested = true;
                throw new Error("rate limited");
            }
            return metadata("1.0.0");
        });

        await loader.ensure("tokio");
        await loader.refresh("tokio");

        expect(refreshRequested).toBe(true);
        expect(state.crates.tokio?.status).toBe("error");
        expect(state.crates.tokio?.error).toBe("rate limited");
        expect(state.crates.tokio?.data?.versions[0]?.num).toBe("1.0.0");
    });

    test("prevents an older normal response from overwriting a refresh", async () => {
        const normalRequest = deferred<CrateMetadata>();
        const refreshRequest = deferred<CrateMetadata>();
        const { state, loader } = createLoader(
            (_name, refresh) => refresh ? refreshRequest.promise : normalRequest.promise);

        const normal = loader.ensure("tokio");
        const refresh = loader.refresh("tokio");

        refreshRequest.resolve(metadata("2.0.0"));
        await refresh;
        normalRequest.resolve(metadata("1.0.0"));
        await normal;

        expect(state.crates.tokio?.status).toBe("ready");
        expect(state.crates.tokio?.data?.versions[0]?.num).toBe("2.0.0");
    });
});
