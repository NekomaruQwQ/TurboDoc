import type { SourceModel } from "@/core/source";
import { SourceDataStore } from "@/core/sourceDataStore.svelte";

/** One compiled source paired with its application-lifetime data store. */
interface RegisteredSourceStore {
    /** Exact model that established this source identity. */
    readonly model: SourceModel;
    /** Lazily created independently persisted store. */
    readonly store: SourceDataStore;
}

/** Lazy application-owned stores that survive UI-only topic switches.
 *
 * Keeping this registry above the keyed Explorer subtree ensures a pending
 * coalesced write is not abandoned merely because the user changes topics.
 */
export class SourceStoreRegistry {
    readonly #sources = new Map<string, RegisteredSourceStore>();

    /** Return the stable store for one compiled source, creating it on first use. */
    get(model: SourceModel): SourceDataStore {
        const existing = this.#sources.get(model.id);
        if (existing) {
            if (existing.model !== model) {
                throw new Error(
                    `Source ID "${model.id}" was registered by two different models.`);
            }
            return existing.store;
        }

        const store = new SourceDataStore(model);
        this.#sources.set(model.id, { model, store });
        return store;
    }

    /** Stop retries only when the application itself is being destroyed. */
    dispose(): void {
        for (const source of this.#sources.values()) source.store.dispose();
        this.#sources.clear();
    }
}
