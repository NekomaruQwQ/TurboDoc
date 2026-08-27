import * as z from "zod";

import type { Adapter, SourceDefinition, SourceModel } from "@/core/source";
import {
    createPageSourceRuntime,
    readNormalizedPinnedPages,
    renderPageSource,
    type PageSourceData,
    type PageSourceRules,
} from "@/adapters/shared/page-source";
import {
    createSectionLayout,
    type RustBookPagePlacement,
} from "@/adapters/rust-book/page-sections";

/** Flat persisted state owned by one Rust book source. */
export interface RustBookSourceData extends PageSourceData {
    /** Ordered canonical pinned pages for this book only. */
    pinnedPages: string[];
}

/** Data-only rules needed to render one checked-in Rust book. */
export interface RustBookRules extends PageSourceRules {
    /** Resolve checked-in reading-order placement, or null for unknown pages. */
    readonly resolvePagePlacement: (url: URL) => RustBookPagePlacement | null;
}

const rustBookSourceDataSchema = z.object({
    schemaVersion: z.literal(1),
    pinnedPages: z.array(z.string()),
});

/** Adapter for immutable Rust book sections and user-owned page pins. */
export const RustBookAdapter: Adapter<RustBookSourceData, RustBookRules> = {
    resolve(definition): SourceModel<RustBookSourceData> {
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
                        ? rustBookSourceDataSchema.parse(raw)
                        : { schemaVersion: 1, pinnedPages: [] },
                    persist: false,
                };
            },
            matchUrl: url => runtime.resolvePage(url) !== null,
            render(context) {
                return renderPageSource(
                    context,
                    definition.id,
                    definition.name,
                    runtime,
                    {
                        readPinnedPages: current =>
                            readNormalizedPinnedPages(runtime, current.data.pinnedPages),
                        writePinnedPages(current, pages) {
                            current.data.pinnedPages =
                                readNormalizedPinnedPages(runtime, pages);
                        },
                        createLayout: (_current, pages) =>
                            createSectionLayout(
                                pages,
                                definition.rules.resolvePagePlacement),
                    });
            },
        };
    },
};

/** Exact definition type accepted by the Rust book adapter. */
export type RustBookSourceDefinition =
    SourceDefinition<RustBookSourceData, RustBookRules>;
