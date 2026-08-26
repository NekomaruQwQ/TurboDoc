import type { DocSiteConfig } from ".";
import { BOOK_CATALOG, type BookDefinition } from "./book-catalog";
import { compileBookOutline, type BookOutlineSnapshot } from "./book-outline";
import snapshots from "./book-outlines.generated.json";

/** Build structural ownership, home aliases and lazy shared placement state. */
function createBookSite(book: BookDefinition, outline: BookOutlineSnapshot): DocSiteConfig {
    const base = new URL(book.baseUrl);
    const roots = [base, ...book.aliases.map(alias => new URL(alias))];
    let placements: ReturnType<typeof compileBookOutline> | undefined;
    return {
        id: book.id,
        name: book.name,
        homeUrl: book.baseUrl,
        ownsUrl: url => roots.some(root => url.origin === root.origin &&
            (url.pathname === root.pathname.slice(0, -1) || url.pathname.startsWith(root.pathname))),
        normalizeUrl(url) {
            const root = roots.find(root => url.origin === root.origin &&
                (url.pathname === root.pathname.slice(0, -1) || url.pathname.startsWith(root.pathname)));
            if (!root) return;
            let path = url.pathname.slice(root.pathname.length);
            // mdBook publishes the first chapter at both its filename and /.
            if (path === "index.html" || path === outline.entries[0]?.path) path = "";
            url.pathname = `${base.pathname}${path}`;
        },
        resolvePageName: book.resolvePageName,
        organization: {
            type: "provider-sections",
            resolvePagePlacement(url) {
                placements ??= compileBookOutline(outline.entries);
                return placements.get(url.pathname.slice(base.pathname.length)) ?? null;
            },
        },
    };
}

/** All runtime sources are explicitly registered and backed by checked-in data. */
export const RUST_BOOK_SITES: readonly DocSiteConfig[] = BOOK_CATALOG.map(book => {
    const outline: BookOutlineSnapshot | undefined =
        (snapshots as Record<string, BookOutlineSnapshot>)[book.id];
    if (!outline) throw new Error(`Missing bundled outline for ${book.id}`);
    return createBookSite(book, outline);
});

/** Existing persisted Rust Book identity and provider landing page. */
export const RUST_BOOK_SITE = RUST_BOOK_SITES.find(site => site.id === "rust-book")
    ?? (() => { throw new Error("The Rust bookshelf requires its landing book"); })();
