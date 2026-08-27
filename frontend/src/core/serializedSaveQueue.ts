/** Options for a serialized, latest-snapshot persistence queue. */
export interface SerializedSaveQueueOptions {
    /** Persist one immutable JSON-compatible snapshot. */
    save(data: object): Promise<void>;
    /** Observe a failed attempt without discarding the dirty snapshot. */
    onError?(error: unknown): void;
    /** Observe recovery after a successful write. */
    onSuccess?(): void;
    /** Initial automatic retry delay. Tests may override this value. */
    retryDelayMs?: number;
}

/** Coalescing save queue that never overlaps or reorders writes.
 *
 * State is snapshotted as JSON at request time, so later mutations cannot
 * alter an in-flight body. Failures retain the newest dirty snapshot and retry
 * with bounded exponential backoff until persistence recovers or the owner is
 * disposed.
 */
export class SerializedSaveQueue {
    readonly #save: (data: object) => Promise<void>;
    readonly #onError?: (error: unknown) => void;
    readonly #onSuccess?: () => void;
    readonly #initialRetryDelayMs: number;
    #persistedSnapshot = "";
    #pendingSnapshot: string | undefined;
    #inFlightSnapshot: string | undefined;
    #draining = false;
    #disposed = false;
    #retryDelayMs: number;
    #retryTimer: ReturnType<typeof setTimeout> | undefined;

    /** Create a queue around one resource-specific save callback. */
    constructor(options: SerializedSaveQueueOptions) {
        this.#save = options.save;
        this.#onError = options.onError;
        this.#onSuccess = options.onSuccess;
        this.#initialRetryDelayMs = options.retryDelayMs ?? 1_000;
        this.#retryDelayMs = this.#initialRetryDelayMs;
    }

    /** Establish the snapshot already known to be durable after loading. */
    markPersisted(data: object): void {
        this.#persistedSnapshot = JSON.stringify(data);
    }

    /** Queue the newest changed snapshot and start the serialized drain. */
    request(data: object): void {
        if (this.#disposed) return;
        const snapshot = JSON.stringify(data);
        if (snapshot === this.#persistedSnapshot ||
            snapshot === this.#pendingSnapshot ||
            snapshot === this.#inFlightSnapshot) return;
        this.#pendingSnapshot = snapshot;
        void this.#drain();
    }

    /** Retry a retained dirty snapshot immediately, primarily for explicit UI
     * recovery and deterministic tests. */
    retryNow(): void {
        if (this.#disposed || !this.#pendingSnapshot) return;
        this.#clearRetryTimer();
        void this.#drain();
    }

    /** Stop future retries. An already in-flight request is allowed to settle. */
    dispose(): void {
        this.#disposed = true;
        this.#clearRetryTimer();
    }

    /** Persist queued snapshots one at a time, coalescing to the newest value. */
    async #drain(): Promise<void> {
        if (this.#draining || this.#disposed) return;
        this.#draining = true;
        try {
            while (this.#pendingSnapshot && !this.#disposed) {
                const snapshot = this.#pendingSnapshot;
                this.#pendingSnapshot = undefined;
                this.#inFlightSnapshot = snapshot;
                try {
                    await this.#save(JSON.parse(snapshot) as object);
                    this.#persistedSnapshot = snapshot;
                    this.#retryDelayMs = this.#initialRetryDelayMs;
                    this.#onSuccess?.();
                } catch (error) {
                    // A newer snapshot subsumes the failed one; otherwise put
                    // the exact failed bytes back so a retry cannot lose data.
                    this.#pendingSnapshot ??= snapshot;
                    this.#onError?.(error);
                    this.#scheduleRetry();
                    return;
                } finally {
                    this.#inFlightSnapshot = undefined;
                }
            }
        } finally {
            this.#draining = false;
        }
    }

    /** Schedule bounded exponential retry without overlapping the drain. */
    #scheduleRetry(): void {
        if (this.#disposed || this.#retryTimer) return;
        this.#retryTimer = setTimeout(() => {
            this.#retryTimer = undefined;
            void this.#drain();
        }, this.#retryDelayMs);
        this.#retryDelayMs = Math.min(this.#retryDelayMs * 2, 30_000);
    }

    /** Cancel a scheduled retry if one exists. */
    #clearRetryTimer(): void {
        if (this.#retryTimer === undefined) return;
        clearTimeout(this.#retryTimer);
        this.#retryTimer = undefined;
    }
}
