import * as IPC from "@/core/ipc";
import type { ProviderData } from "@/core/data";

/** Per-provider data + autosave, replacing the old `useProviderDataLoader`
 *  React hook. Owned by `ExplorerProvider.svelte`; descendants receive it
 *  via the `providerData` context entry.
 *
 *  - `data` is `$state`-proxied — child components mutate it directly
 *    (e.g. `store.data.groups[name].items = [...]`) and Svelte tracks the
 *    deep change.
 *  - The host component calls `load()` once and then sets up an `$effect`
 *    that calls `autoSave()`; the effect tracks the deep `$state` reads
 *    inside `JSON.stringify` and re-runs after every mutation. */
export class ProviderDataStore {
    data: ProviderData = $state({ data: {}, groups: {}, groupOrder: [] });
    #loaded = false;
    #lastJson = "{}";
    #providerId: string;

    constructor(providerId: string) {
        this.#providerId = providerId;
    }

    /** Load provider data from the server. Idempotent — safe to call
     *  multiple times; only the first call has effect. */
    async load(): Promise<void> {
        if (this.#loaded) return;
        try {
            const loaded = (await IPC.loadProviderData(this.#providerId)) as Partial<ProviderData>;
            this.data = {
                data: loaded.data ?? {},
                groups: loaded.groups ?? {},
                groupOrder: loaded.groupOrder ?? [],
            };
            this.#lastJson = JSON.stringify(this.data);
        } catch (err) {
            console.error(`Failed to load provider data for "${this.#providerId}":`, err);
        }
        this.#loaded = true;
    }

    /** Persist `data` if it changed since the last save. Suppressed until
     *  the initial load completes, so the empty-default state never
     *  overwrites real data on disk. */
    autoSave(): void {
        const json = JSON.stringify(this.data);
        if (!this.#loaded) return;
        if (json === this.#lastJson) return;
        this.#lastJson = json;
        IPC.saveProviderData(this.#providerId, this.data as object)
            .catch(err => console.error(err));
    }
}
