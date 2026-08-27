import {
    RustBookAdapter,
    type RustBookSourceDefinition,
} from "@/adapters/rust-book";
import { resolveSource } from "@/core/source";

import { BOOK_CATALOG, type BookDefinition } from "./catalog";
import { compileBookOutline, type BookOutlineSnapshot } from "./outline";
import snapshots from "./outlines.generated.json";

/** Pair one checked-in book catalog entry and outline with RustBookAdapter. */
function createBookDefinition(
    book: BookDefinition,
    outline: BookOutlineSnapshot,
): RustBookSourceDefinition {
    const base = new URL(book.baseUrl);
    const roots = [base, ...book.aliases.map(alias => new URL(alias))];
    let placements: ReturnType<typeof compileBookOutline> | undefined;
    return {
        id: book.id,
        name: book.name,
        adapter: RustBookAdapter,
        rules: {
            homeUrl: book.baseUrl,
            ownsUrl: url => roots.some(root => url.origin === root.origin &&
                (url.pathname === root.pathname.slice(0, -1) ||
                    url.pathname.startsWith(root.pathname))),
            normalizeUrl(url) {
                const root = roots.find(candidate =>
                    url.origin === candidate.origin &&
                    (url.pathname === candidate.pathname.slice(0, -1) ||
                        url.pathname.startsWith(candidate.pathname)));
                if (!root) return;
                let path = url.pathname.slice(root.pathname.length);
                // mdBook publishes its first chapter at both its filename and
                // the root; one canonical target prevents duplicate pins.
                if (path === "index.html" || path === outline.entries[0]?.path) path = "";
                url.pathname = `${base.pathname}${path}`;
            },
            resolvePageName: book.resolvePageName,
            resolvePagePlacement(url) {
                placements ??= compileBookOutline(outline.entries);
                return placements.get(url.pathname.slice(base.pathname.length)) ?? null;
            },
        },
    };
}

/** All data-driven Rust book definitions in stable reading/catalog order. */
export const RustBookDefinitions: readonly RustBookSourceDefinition[] =
    BOOK_CATALOG.map(book => {
        const outline: BookOutlineSnapshot | undefined =
            (snapshots as Record<string, BookOutlineSnapshot>)[book.id];
        if (!outline) throw new Error(`Missing bundled outline for ${book.id}`);
        return createBookDefinition(book, outline);
    });

/** Independently compiled and persisted Rust book source models. */
export const RustBookSources = RustBookDefinitions.map(resolveSource);

/** Existing Rust Book identity used as the Rust Books topic landing source. */
export const RustBookSource = RustBookSources.find(source => source.id === "rust-book")
    ?? (() => { throw new Error("The Rust bookshelf requires its landing book"); })();
