import type { Page, PageBlock, PageBlockNameAction, PageLayout } from "@/core/data";
import { reorderPinnedPages, type ResolveDocPage } from "./page-order";

/** User-defined ordered subsets of the site's authoritative pinned URLs. */
export type PageCollections = Record<string, { pages: string[] }>;

/** Sanitized current state used by each mutation, never a stale render copy. */
export interface CollectionState {
    /** Authoritative membership and fallback order for loose pins. */
    pinnedPages: string[];
    /** Names are persisted identities; display order is always alphabetical. */
    collections: PageCollections;
}

/** Keep only valid pins; ambiguous cross-collection claims become loose.
 * Duplicate entries within one collection count as only one claim. */
export function normalizePageCollections(
    pinnedPages: readonly string[],
    input: unknown,
    resolvePage: ResolveDocPage): PageCollections {
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    const pinned = new Map(pinnedPages.flatMap(url => {
        const target = resolvePage(url);
        return target ? [[target.identity, url] as const] : [];
    }));
    const claims = new Map<string, number>();
    const entries = Object.entries(input).flatMap(([name, value]) => {
        if (!name.trim() || name !== name.trim()) return [];
        const rawPages: unknown = value && typeof value === "object" && "pages" in value
            ? value.pages : [];
        const identities = new Set<string>();
        if (Array.isArray(rawPages)) {
            for (const url of rawPages) {
                const target = typeof url === "string" ? resolvePage(url) : null;
                if (target && pinned.has(target.identity)) identities.add(target.identity);
            }
        }
        for (const identity of identities) claims.set(identity, (claims.get(identity) ?? 0) + 1);
        return [{ name, identities }];
    });
    return Object.fromEntries(entries.map(({ name, identities }) => [name, {
        pages: [...identities].flatMap(identity => {
            const url = pinned.get(identity);
            return url && claims.get(identity) === 1 ? [url] : [];
        }),
    }]));
}

/** Preserve authoritative order after subtracting every valid collection. */
function loosePages(state: CollectionState): string[] {
    const grouped = new Set(Object.values(state.collections).flatMap(value => value.pages));
    return state.pinnedPages.filter(url => !grouped.has(url));
}

/** Namespace presentation IDs so a collection named "preview" is harmless. */
function collectionId(name: string): string { return `collection:${name}`; }

/** Compose user collections without exposing that concept to the renderer.
 * Reads and writes are supplied by the provider so every action validates the
 * latest reactive state, while rendering itself remains a pure derivation. */
export function createCollectionLayout(
    pages: readonly Page[],
    read: () => CollectionState,
    write: (state: CollectionState) => void,
    resolvePage: ResolveDocPage): PageLayout {
    const state = read();

    /** Reject blank, duplicate or stale names before replacing any state. */
    function nameAction(previous?: string): PageBlockNameAction {
        return {
            label: previous === undefined ? "Add collection" : "Rename collection",
            value: previous ?? "",
            placeholder: "Collection name…",
            invoke(input) {
                const current = read();
                const name = input.trim();
                if (!name) return { error: "Enter a collection name." };
                if (previous !== undefined && !Object.hasOwn(current.collections, previous))
                    return { error: "This collection no longer exists." };
                if (name !== previous && Object.hasOwn(current.collections, name))
                    return { error: "A collection with that name already exists." };
                const value = previous === undefined ? { pages: [] }
                    : current.collections[previous] ?? { pages: [] };
                if (previous !== undefined) delete current.collections[previous];
                // Computed properties preserve names such as __proto__ as data.
                current.collections = { ...current.collections, [name]: value };
                write(current);
                return { blockId: collectionId(name) };
            },
        };
    }

    const blocks: PageBlock[] = [
        { id: "home", pageUrls: pages.filter(page => page.pinned === null).map(page => page.url) },
        { id: "", pageUrls: loosePages(state), reorderable: true, accessibleName: "Loose pages" },
        { id: "preview", pageUrls: pages.filter(page => page.pinned === false).map(page => page.url) },
        ...Object.keys(state.collections).sort((a, b) => a.localeCompare(b)).map(name => {
            const pageUrls = state.collections[name]?.pages ?? [];
            return {
                id: collectionId(name),
                titlePath: [name],
                pageUrls,
                reorderable: true,
                accessibleName: `Pages in ${name}`,
                rename: nameAction(name),
                remove: {
                    label: "Remove collection",
                    confirmation: pageUrls.length
                        ? `Remove “${name}”? Its pinned pages will move to the end of the loose pages.`
                        : undefined,
                    invoke() {
                        const current = read();
                        if (!Object.hasOwn(current.collections, name)) return;
                        const removed = current.collections[name]?.pages ?? [];
                        const removedSet = new Set(removed);
                        current.pinnedPages = [
                            ...current.pinnedPages.filter(url => !removedSet.has(url)),
                            ...removed,
                        ];
                        delete current.collections[name];
                        write(current);
                    },
                },
            };
        }),
    ];

    return {
        blocks,
        create: nameAction(),
        reorder(orders) {
            const current = read();
            const namesById = new Map(Object.keys(current.collections)
                .map(name => [collectionId(name), name]));
            const expected = new Set(["", ...namesById.keys()]);
            if (orders.length !== expected.size) return;
            for (const order of orders) {
                if (!expected.delete(order.id)) return;
            }
            const reordered = reorderPinnedPages(
                current.pinnedPages,
                orders.flatMap(order => [...order.pageUrls]),
                resolvePage);
            if (!reordered) return;
            let offset = 0;
            for (const order of orders) {
                const name = namesById.get(order.id);
                const urls = reordered.slice(offset, offset + order.pageUrls.length);
                if (name !== undefined) current.collections[name] = { pages: urls };
                offset += order.pageUrls.length;
            }
            current.pinnedPages = reordered;
            write(current);
        },
    };
}
