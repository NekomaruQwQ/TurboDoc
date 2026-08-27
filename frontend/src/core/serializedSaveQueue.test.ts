import { describe, expect, test } from "bun:test";

import { SerializedSaveQueue } from "./serializedSaveQueue";

/** One externally settled promise used to observe queue ordering. */
function deferred(): {
    promise: Promise<void>;
    resolve(): void;
    reject(error: unknown): void;
} {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

/** Let continuations queued by resolved save promises run. */
async function settleMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe("SerializedSaveQueue", () => {
    test("coalesces changes while keeping writes serialized", async () => {
        const first = deferred();
        const second = deferred();
        const snapshots: object[] = [];
        let concurrent = 0;
        let peakConcurrent = 0;
        const attempts = [first, second];
        const queue = new SerializedSaveQueue({
            async save(data) {
                const attempt = attempts[snapshots.length];
                snapshots.push(data);
                concurrent++;
                peakConcurrent = Math.max(peakConcurrent, concurrent);
                await attempt?.promise;
                concurrent--;
            },
        });
        queue.markPersisted({ value: 0 });

        queue.request({ value: 1 });
        queue.request({ value: 2 });
        queue.request({ value: 3 });
        expect(snapshots).toEqual([{ value: 1 }]);

        first.resolve();
        await settleMicrotasks();
        expect(snapshots).toEqual([{ value: 1 }, { value: 3 }]);

        second.resolve();
        await settleMicrotasks();
        expect(peakConcurrent).toBe(1);
        queue.dispose();
    });

    test("retains the newest dirty snapshot after failure", async () => {
        const snapshots: object[] = [];
        let fail = true;
        const queue = new SerializedSaveQueue({
            retryDelayMs: 60_000,
            async save(data) {
                snapshots.push(data);
                if (fail) throw new Error("offline");
            },
        });
        queue.markPersisted({ value: 0 });

        queue.request({ value: 1 });
        queue.request({ value: 2 });
        await settleMicrotasks();
        fail = false;
        queue.retryNow();
        await settleMicrotasks();

        expect(snapshots).toEqual([{ value: 1 }, { value: 2 }]);
        queue.dispose();
    });
});
