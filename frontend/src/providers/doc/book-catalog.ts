import {
    resolveAnalyzerPageName,
    resolveBookPageName,
    resolveNomiconPageName,
    resolveRustBookPageName,
    resolveUnstablePageName,
} from "./page-names";

/** A code-owned book boundary shared by the runtime and offline refresh tool. */
export interface BookDefinition {
    /** Persisted item identity, independent of the current book title. */
    id: string;
    /** Compact Explorer item label. */
    name: string;
    /** Canonical trailing-slash root, also the fixed Home target. */
    baseUrl: string;
    /** Verified equivalent roots, never different release channels. */
    aliases: readonly string[];
    /** Site policy remains an ordinary callback, not a naming-strategy enum. */
    resolvePageName(url: URL): string;
}

/** Stable release books share an unversioned alias on the same host. */
function stableBook(
    id: string, name: string, path: string,
    resolvePageName = resolveBookPageName): BookDefinition {
    return {
        id, name,
        baseUrl: `https://doc.rust-lang.org/stable/${path}/`,
        aliases: [`https://doc.rust-lang.org/${path}/`],
        resolvePageName,
    };
}

/** Bounded English bookshelf; no startup discovery or automatic registration. */
export const BOOK_CATALOG: readonly BookDefinition[] = [
    stableBook("rust-book", "Rust Book", "book", resolveRustBookPageName),
    stableBook("cargo-book", "Cargo Book", "cargo"),
    stableBook("nomicon", "Rustonomicon", "nomicon", resolveNomiconPageName),
    {
        id: "rust-analyzer", name: "rust-analyzer Book",
        baseUrl: "https://rust-analyzer.github.io/book/", aliases: [],
        resolvePageName: resolveAnalyzerPageName,
    },
    stableBook("rust-by-example", "Rust By Example", "rust-by-example"),
    stableBook("rust-reference", "Rust Reference", "reference"),
    stableBook("edition-guide", "Edition Guide", "edition-guide"),
    stableBook("rustc-book", "rustc Book", "rustc"),
    stableBook("rustdoc-book", "rustdoc Book", "rustdoc"),
    stableBook("clippy-book", "Clippy Book", "clippy"),
    stableBook("style-guide", "Rust Style Guide", "style-guide"),
    {
        id: "unstable-book", name: "Unstable Book",
        baseUrl: "https://doc.rust-lang.org/nightly/unstable-book/", aliases: [],
        resolvePageName: resolveUnstablePageName,
    },
    stableBook("embedded-book", "Embedded Rust Book", "embedded-book"),
    {
        id: "rustc-dev-guide", name: "rustc Development Guide",
        baseUrl: "https://rustc-dev-guide.rust-lang.org/", aliases: [],
        resolvePageName: resolveBookPageName,
    },
    {
        id: "rustup-book", name: "rustup Book",
        baseUrl: "https://rust-lang.github.io/rustup/", aliases: [],
        resolvePageName: resolveBookPageName,
    },
];
