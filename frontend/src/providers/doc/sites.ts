import type { DocSiteConfig } from ".";

/** English Wikipedia, matched by exact HTTPS origin. */
export const WIKIPEDIA_SITE = {
    id: "wikipedia",
    name: "Wikipedia",
    homeUrl: "https://en.wikipedia.org/wiki/Main_Page",
    ownsUrl: url => url.origin === "https://en.wikipedia.org",
    resolvePageName: resolveMediaWikiPageName,
} satisfies DocSiteConfig;

/** Stable Rust Book, including its server-supported unversioned alias. */
export const RUST_BOOK_SITE = {
    id: "rust-book",
    name: "Rust Book",
    homeUrl: "https://doc.rust-lang.org/stable/book/",
    ownsUrl: url => url.origin === "https://doc.rust-lang.org" &&
        isRustBookPath(url.pathname),
    normalizeUrl: normalizeRustBookAlias,
    resolvePageName: resolveRustBookPageName,
} satisfies DocSiteConfig;

/** Community Minecraft Wiki, matched by exact HTTPS origin. */
export const MINECRAFT_WIKI_SITE = {
    id: "minecraft-wiki",
    name: "Minecraft Wiki",
    homeUrl: "https://minecraft.wiki/",
    ownsUrl: url => url.origin === "https://minecraft.wiki",
    resolvePageName: resolveMediaWikiPageName,
} satisfies DocSiteConfig;

/** Extract a MediaWiki article title without depending on live site metadata. */
export function resolveMediaWikiPageName(url: URL): string {
    let slug: string | null = null;
    if (url.pathname === "/w/index.php") slug = url.searchParams.get("title");
    if (!slug) {
        const prefix = url.pathname.startsWith("/wiki/") ? "/wiki/" : "/w/";
        slug = url.pathname.startsWith(prefix)
            ? url.pathname.slice(prefix.length)
            : url.pathname.split("/").filter(Boolean).at(-1) ?? "Page";
    }
    return decodeSlug(slug).replaceAll("_", " ") || "Page";
}

/** Derive a sentence-style label from a stable Rust Book filename. */
export function resolveRustBookPageName(url: URL): string {
    const fileName = url.pathname.split("/").filter(Boolean).at(-1) ?? "Home";
    const slug = decodeSlug(fileName)
        .replace(/\.html$/i, "")
        .replace(/^(?:ch\d+-\d+|appendix-\d+)-/, "")
        .replaceAll("-", " ");
    return slug ? `${slug[0]?.toUpperCase()}${slug.slice(1)}` : "Page";
}

/** Accept the stable Book and its server-supported unversioned alias only. */
function isRustBookPath(pathname: string): boolean {
    return pathname === "/stable/book" ||
        pathname.startsWith("/stable/book/") ||
        pathname === "/book" ||
        pathname.startsWith("/book/");
}

/** Collapse the unversioned Book alias into the stable persisted identity. */
function normalizeRustBookAlias(url: URL): void {
    if (url.pathname === "/book" || url.pathname === "/stable/book") {
        url.pathname = "/stable/book/";
    } else if (url.pathname.startsWith("/book/")) {
        url.pathname = `/stable${url.pathname}`;
    }
}

/** Decode URL slugs defensively because malformed escapes must not break UI. */
function decodeSlug(slug: string): string {
    try {
        return decodeURIComponent(slug);
    } catch {
        return slug;
    }
}
