import * as z from "zod";

import * as API from "@/core/api";
import { isItemKey, parseItemKey, type ItemKey } from "@/core/itemKey";
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

/** Current source evidence used to reconcile one topic's group memberships. */
export interface ExplorerItemReconciliation {
    /** Every source still registered under the topic. */
    readonly registeredSourceIds: readonly string[];
    /** Registered sources whose validated item views are available. */
    readonly readySourceIds: readonly string[];
    /** Composite items currently rendered by the ready sources. */
    readonly validItemIds: readonly ItemKey[];
}

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

    /** Remove retired topic records and canonicalize every surviving group
     *  order against the current registry. Missing groups are appended so a
     *  malformed order cannot make persisted groups inaccessible. */
    reconcileTopics(topicIds: readonly string[]): void {
        reconcileExplorerWorkspaceTopics(this.data, topicIds);
    }

    /** Remove duplicate, retired-source, and confirmed-stale item references
     *  from one topic while preserving items owned by unavailable sources. */
    reconcileTopicItems(
        topicId: string,
        evidence: ExplorerItemReconciliation,
    ): void {
        const topicData = this.data.topics[topicId];
        if (topicData) reconcileExplorerTopicItems(topicData, evidence);
    }

    /** Queue changed workspace state after a deep reactive read. */
    autoSave(): void {
        if (this.status === "ready") this.#saveQueue.request(this.data);
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
            // Materialize a fresh workspace so explicit empty state remains
            // distinguishable from a resource that has never been persisted.
            if (!resource.exists) this.#saveQueue.request(this.data);
        } catch (error) {
            this.status = "error";
            this.error = errorMessage(error);
        }
    }
}

/** Reconcile persisted topic identity and group ordering in place. Returns
 *  whether any state changed so the algorithm is directly testable. */
export function reconcileExplorerWorkspaceTopics(
    data: ExplorerWorkspaceData,
    topicIds: readonly string[],
): boolean {
    const registeredTopicIds = new Set(topicIds);
    let changed = false;
    for (const topicId of Object.keys(data.topics)) {
        if (!registeredTopicIds.has(topicId)) {
            delete data.topics[topicId];
            changed = true;
        }
    }

    for (const topicData of Object.values(data.topics)) {
        const groupNames = Object.keys(topicData.groups);
        const groupNameSet = new Set(groupNames);
        const seen = new Set<string>();
        const nextOrder = topicData.groupOrder.filter(groupName => {
            if (!groupNameSet.has(groupName) || seen.has(groupName)) return false;
            seen.add(groupName);
            return true;
        });
        nextOrder.push(...groupNames.filter(groupName => !seen.has(groupName)));
        if (!sameStrings(topicData.groupOrder, nextOrder)) {
            topicData.groupOrder = nextOrder;
            changed = true;
        }
    }
    return changed;
}

/** Reconcile one topic's group members in place. Returns whether any state
 *  changed; registered loading/error sources deliberately retain their keys. */
export function reconcileExplorerTopicItems(
    topicData: ExplorerTopicData,
    evidence: ExplorerItemReconciliation,
): boolean {
    const registeredSourceIds = new Set(evidence.registeredSourceIds);
    const readySourceIds = new Set(evidence.readySourceIds.filter(sourceId =>
        registeredSourceIds.has(sourceId)));
    const validItemIds = new Set(evidence.validItemIds);
    let changed = false;

    for (const group of Object.values(topicData.groups)) {
        const seen = new Set<ItemKey>();
        const nextItems = group.items.filter(itemId => {
            const parsed = parseItemKey(itemId);
            if (!parsed || !registeredSourceIds.has(parsed.sourceId)) return false;
            if (readySourceIds.has(parsed.sourceId) && !validItemIds.has(itemId))
                return false;
            if (seen.has(itemId)) return false;
            seen.add(itemId);
            return true;
        });
        if (!sameStrings(group.items, nextItems)) {
            group.items = nextItems;
            changed = true;
        }
    }
    return changed;
}

/** Return whether two string sequences have identical values and order. */
function sameStrings(
    left: readonly string[],
    right: readonly string[],
): boolean {
    return left.length === right.length &&
        left.every((value, index) => value === right[index]);
}

/** Convert arbitrary failures to stable UI text. */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
