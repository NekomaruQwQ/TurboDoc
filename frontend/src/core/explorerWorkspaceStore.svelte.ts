import * as z from "zod";

import * as API from "@/core/api";
import { isItemKey, type ItemKey } from "@/core/itemKey";
import { SerializedSaveQueue } from "@/core/serializedSaveQueue";

/** Root-level persistence ID reserved for topic-owned Explorer state. */
export const EXPLORER_WORKSPACE_DATA_ID = "ui.explorer";

const explorerTopicDataSchema = z.object({
    groups: z.record(z.string(), z.object({
        items: z.array(z.string().refine(isItemKey)).transform(items => items as ItemKey[]),
    })),
    groupOrder: z.array(z.string()),
});

const explorerWorkspaceDataSchema = z.object({
    schemaVersion: z.literal(1),
    topics: z.record(z.string(), explorerTopicDataSchema),
});

/** Named item groups owned only by one topic's Explorer presentation. */
export type ExplorerTopicData = z.infer<typeof explorerTopicDataSchema>;

/** UI-only groups for every topic, independent of source persistence. */
export type ExplorerWorkspaceData = z.infer<typeof explorerWorkspaceDataSchema>;

/** Reactive Explorer workspace with serialized coalescing persistence. */
export class ExplorerWorkspaceStore {
    /** Complete UI-owned workspace state. */
    data: ExplorerWorkspaceData = $state({ schemaVersion: 1, topics: {} });
    /** Whether the root-level UI resource is ready for use. */
    status: "idle" | "loading" | "ready" | "error" = $state("idle");
    /** Load failure, if any. */
    error: string | null = $state(null);
    /** Latest write failure; dirty data remains queued. */
    saveError: string | null = $state(null);
    readonly #saveQueue: SerializedSaveQueue;
    #loadPromise: Promise<void> | undefined;

    /** Create the single application-owned Explorer workspace store. */
    constructor() {
        this.#saveQueue = new SerializedSaveQueue({
            save: data => API.saveDataFile(EXPLORER_WORKSPACE_DATA_ID, data),
            onError: error => this.saveError = errorMessage(error),
            onSuccess: () => this.saveError = null,
        });
    }

    /** Load the UI resource once. A genuinely missing file starts empty. */
    load(): Promise<void> {
        if (this.status === "ready") return Promise.resolve();
        if (this.#loadPromise) return this.#loadPromise;
        this.status = "loading";
        this.error = null;
        this.#loadPromise = this.#load()
            .finally(() => this.#loadPromise = undefined);
        return this.#loadPromise;
    }

    /** Return mutable state for a topic, creating its UI-only container lazily. */
    topicData(topicId: string): ExplorerTopicData {
        this.data.topics[topicId] ??= { groups: {}, groupOrder: [] };
        // Re-read through the $state proxy because the assignment expression
        // itself yields its raw right-hand value for a newly created topic.
        return this.data.topics[topicId];
    }

    /** Queue changed workspace state after a deep reactive read. */
    autoSave(): void {
        if (this.status === "ready") this.#saveQueue.request(this.data);
    }

    /** Retry a failed load. */
    retryLoad(): Promise<void> {
        if (this.status !== "error") return Promise.resolve();
        return this.load();
    }

    /** Retry a retained dirty write immediately. */
    retrySave(): void {
        this.#saveQueue.retryNow();
    }

    /** Stop future persistence retries during application teardown. */
    dispose(): void {
        this.#saveQueue.dispose();
    }

    /** Read and validate the root-level UI resource. */
    async #load(): Promise<void> {
        try {
            const resource = await API.loadDataFile(EXPLORER_WORKSPACE_DATA_ID);
            this.data = resource.exists
                ? explorerWorkspaceDataSchema.parse(resource.data)
                : { schemaVersion: 1, topics: {} };
            this.#saveQueue.markPersisted(resource.exists ? this.data : {});
            this.status = "ready";
            // Materialize the migration target on a fresh workspace so the
            // removable legacy probe does not repeat on every later launch.
            if (!resource.exists) this.#saveQueue.request(this.data);
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
