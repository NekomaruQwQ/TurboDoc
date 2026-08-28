import * as z from "zod";
import ImportIcon from "@lucide/svelte/icons/import";

import type { Adapter, SourceDefinition, SourceModel } from "@/core/source";
import {
    createPageSourceRuntime,
    readNormalizedPinnedPages,
    renderPageSource,
    type PageSourceData,
    type PageSourceRules,
} from "@/adapters/shared/page-source";
import {
    createCollectionLayout,
    normalizePageCollections,
    type PageCollections,
} from "@/adapters/web/page-collections";

/** Flat persisted state owned by one general web source. */
export interface WebSourceData extends PageSourceData {
    /** Ordered canonical pinned pages for this web source only. */
    pinnedPages: string[];
    /** Optional user-created ordered page subsets. */
    collections?: PageCollections;
}

/** Data-only URL and naming rules consumed by the general web adapter. */
export type WebRules = PageSourceRules;

const webSourceDataSchema = z.object({
    schemaVersion: z.literal(1),
    pinnedPages: z.array(z.string()),
    collections: z.record(z.string(), z.object({
        pages: z.array(z.string()),
    })).optional(),
});

/** General adapter for user-pinned web pages and user-owned collections. */
export const WebAdapter: Adapter<WebSourceData, WebRules> = {
    resolve(definition): SourceModel<WebSourceData> {
        const runtime = createPageSourceRuntime(definition.id, definition.rules);
        return {
            id: definition.id,
            name: definition.name,
            homeUrl: runtime.home.url,
            presentation: {
                renderItemNameAsCode: false,
                renderPageNameAsCode: false,
            },
            initializeData(raw, exists) {
                return {
                    data: exists
                        ? webSourceDataSchema.parse(raw)
                        : { schemaVersion: 1, pinnedPages: [] },
                    persist: false,
                };
            },
            matchUrl: url => runtime.resolvePage(url) !== null,
            render(context) {
                const readPinnedPages = () =>
                    readNormalizedPinnedPages(runtime, context.data.pinnedPages);
                const writePinnedPages = (pages: readonly string[]) => {
                    context.data.pinnedPages = readNormalizedPinnedPages(runtime, pages);
                    context.data.collections = normalizePageCollections(
                        context.data.pinnedPages,
                        context.data.collections,
                        runtime.resolvePage);
                };
                const view = renderPageSource(
                    context,
                    definition.id,
                    definition.name,
                    runtime,
                    {
                        readPinnedPages,
                        writePinnedPages: (_current, pages) => writePinnedPages(pages),
                        createLayout: (_current, pages) =>
                            createCollectionLayout(pages, () => {
                                const pinnedPages = readPinnedPages();
                                return {
                                    pinnedPages,
                                    collections: normalizePageCollections(
                                        pinnedPages,
                                        context.data.collections,
                                        runtime.resolvePage),
                                };
                            }, state => {
                                context.data.pinnedPages = state.pinnedPages;
                                context.data.collections = state.collections;
                            }, runtime.resolvePage),
                    });
                if (view.search) {
                    view.search.emptyAction = {
                        type: "input",
                        name: `Import ${definition.name}`,
                        icon: { type: "lucide", icon: ImportIcon },
                        dialogTitle: `Import ${definition.name} pages`,
                        dialogDescription:
                            "Paste one page URL per line. Invalid, unsupported, duplicate, and home URLs are skipped.",
                        placeholder: "One HTTPS page URL per line",
                        multiline: true,
                        confirmLabel: "Import",
                        /** Merge against current pins so an open dialog cannot overwrite later edits.
                         * Existing targets win duplicate identities; empty or rejected input is a no-op. */
                        invoke(text) {
                            const current = readPinnedPages();
                            const pages = readNormalizedPinnedPages(runtime, [
                                ...current,
                                ...text.split("\n").map(line => line.trim()),
                            ]);
                            if (pages.length > current.length) writePinnedPages(pages);
                        },
                    };
                }
                return view;
            },
        };
    },
};

/** Exact definition type accepted by the web adapter. */
export type WebSourceDefinition = SourceDefinition<WebSourceData, WebRules>;
