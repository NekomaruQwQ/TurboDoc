/** A code-owned documentation site exposed as one Doc provider item. */
export interface DocSite {
    /** Stable identifier used by persistence and group membership. */
    readonly id: string;

    /** User-facing site name. */
    readonly name: string;

    /** Fixed page displayed first and opened when the site is selected. */
    readonly homeUrl: string;
}

/** A supported Doc navigation paired with its normalized target URL. */
export interface DocPageTarget {
    /** Site that owns the URL. */
    readonly site: DocSite;

    /** Normalized absolute target; fragments remain navigation targets. */
    readonly url: string;
}

/** Immutable first-party catalog for the initial Doc provider milestone. */
export const DOC_SITES = [
    {
        id: "wikipedia",
        name: "Wikipedia",
        homeUrl: "https://en.wikipedia.org/wiki/Main_Page",
    },
    {
        id: "rust-book",
        name: "Rust Book",
        homeUrl: "https://doc.rust-lang.org/stable/book/",
    },
    {
        id: "minecraft-wiki",
        name: "Minecraft Wiki",
        homeUrl: "https://minecraft.wiki/",
    },
] as const satisfies readonly DocSite[];

/** Parse an HTTPS URL only when one catalog site owns the full origin/path. */
export function parseDocPageTarget(input: string): DocPageTarget | null {
    let url: URL;
    try {
        url = new URL(input);
    } catch {
        return null;
    }

    if (url.protocol !== "https:" || url.username || url.password) return null;

    const site = DOC_SITES.find(candidate => siteOwnsUrl(candidate, url));
    if (!site) return null;

    if (site.id === "rust-book") normalizeRustBookAlias(url);
    url.searchParams.sort();
    return { site, url: url.href };
}

/** Return the page identity used for pinning and current-page comparison.
 * Fragments select a section within a page and therefore do not create a
 * second pinned entry. */
export function getDocPageIdentity(input: string): string | null {
    const target = parseDocPageTarget(input);
    if (!target) return null;

    const url = new URL(target.url);
    url.hash = "";
    return url.href;
}

/** Derive a compact human-readable page label from a supported URL. */
export function getDocPageName(site: DocSite, input: string): string {
    const target = parseDocPageTarget(input);
    if (!target || target.site.id !== site.id) return "Unknown page";
    if (getDocPageIdentity(target.url) === getDocPageIdentity(site.homeUrl))
        return "Home";

    const url = new URL(target.url);
    if (site.id === "rust-book") return rustBookPageName(url);
    return wikiPageName(url);
}

/** Test structural ownership after URL parsing has validated the scheme. */
function siteOwnsUrl(site: DocSite, url: URL): boolean {
    switch (site.id) {
        case "wikipedia":
            return url.origin === "https://en.wikipedia.org";
        case "minecraft-wiki":
            return url.origin === "https://minecraft.wiki";
        case "rust-book":
            return url.origin === "https://doc.rust-lang.org" &&
                isRustBookPath(url.pathname);
        default:
            return false;
    }
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

/** Extract MediaWiki article titles without depending on live site metadata. */
function wikiPageName(url: URL): string {
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

/** Convert stable Rust Book filenames into sentence-style labels. */
function rustBookPageName(url: URL): string {
    const fileName = url.pathname.split("/").filter(Boolean).at(-1) ?? "Home";
    const slug = decodeSlug(fileName)
        .replace(/\.html$/i, "")
        .replace(/^(?:ch\d+-\d+|appendix-\d+)-/, "")
        .replaceAll("-", " ");
    return slug ? `${slug[0]?.toUpperCase()}${slug.slice(1)}` : "Page";
}

/** Decode URL slugs defensively because malformed escapes must not break UI. */
function decodeSlug(slug: string): string {
    try {
        return decodeURIComponent(slug);
    } catch {
        return slug;
    }
}
