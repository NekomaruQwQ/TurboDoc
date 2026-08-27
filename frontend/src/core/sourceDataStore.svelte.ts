import * as API from "@/core/api";
import { SerializedSaveQueue } from "@/core/serializedSaveQueue";
import type { SourceModel } from "@/core/source";

/** Load state for one independently persisted source. */
export type SourceLoadStatus = "idle" | "loading" | "ready" | "error";

/** Reactive data and reliable autosave for one compiled source model. */
export class SourceDataStore<D extends object = object> {
    /** Source-specific flattened state. Valid only after a ready load. */
    data: D = $state({} as D);
    /** Independent load state used by topic composition and retry UI. */
    status: SourceLoadStatus = $state("idle");
    /** Human-readable load failure, if any. */
    error: string | null = $state(null);
    /** Human-readable persistence failure while dirty data is retained. */
    saveError: string | null = $state(null);
    readonly #model: SourceModel<D>;
    readonly #saveQueue: SerializedSaveQueue;
    #loadPromise: Promise<void> | undefined;

    /** Create a store whose parsing/default policy comes from its source model. */
    constructor(model: SourceModel<D>) {
        this.#model = model;
        this.#saveQueue = new SerializedSaveQueue({
            save: data => API.saveSourceData(model.id, data),
            onError: error => this.saveError = errorMessage(error),
            onSuccess: () => this.saveError = null,
        });
    }

    /** Load and validate this source exactly once unless an error is retried. */
    load(): Promise<void> {
        if (this.status === "ready") return Promise.resolve();
        if (this.#loadPromise) return this.#loadPromise;

        this.status = "loading";
        this.error = null;
        this.#loadPromise = this.#load()
            .finally(() => this.#loadPromise = undefined);
        return this.#loadPromise;
    }

    /** Retry a failed source load without affecting sibling sources. */
    retryLoad(): Promise<void> {
        if (this.status !== "error") return Promise.resolve();
        return this.load();
    }

    /** Queue the current state when deep reactive reads detect a change. */
    autoSave(): void {
        if (this.status === "ready") this.#saveQueue.request(this.data);
    }

    /** Retry a retained dirty write immediately. */
    retrySave(): void {
        this.#saveQueue.retryNow();
    }

    /** Stop future retry timers when the owning Explorer is destroyed. */
    dispose(): void {
        this.#saveQueue.dispose();
    }

    /** Perform one server load followed by adapter-owned validation. */
    async #load(): Promise<void> {
        try {
            const resource = await API.loadSourceData(this.#model.id);
            const initialized = this.#model.initializeData(resource.data, resource.exists);
            this.data = initialized.data;
            this.#saveQueue.markPersisted(
                initialized.persist ? (resource.data as object) : initialized.data);
            this.status = "ready";
            if (initialized.persist) this.#saveQueue.request(initialized.data);
        } catch (error) {
            this.status = "error";
            this.error = errorMessage(error);
        }
    }
}

/** Convert arbitrary failures to stable UI text. */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
