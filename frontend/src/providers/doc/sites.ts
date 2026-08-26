import type { DocSiteConfig } from ".";
import { decodePageSlug } from "./page-names";

export { RUST_BOOK_SITE } from "./books";
export { resolveRustBookPageName } from "./page-names";

/** English Wikipedia, matched by exact HTTPS origin. */
export const WIKIPEDIA_SITE = {
    id: "wikipedia",
    name: "Wikipedia",
    homeUrl: "https://en.wikipedia.org/wiki/Main_Page",
    ownsUrl: url => url.origin === "https://en.wikipedia.org",
    resolvePageName: resolveMediaWikiPageName,
    organization: { type: "user-collections" },
} satisfies DocSiteConfig;

/** Community Minecraft Wiki, matched by exact HTTPS origin. */
export const MINECRAFT_WIKI_SITE = {
    id: "minecraft-wiki",
    name: "Minecraft Wiki",
    homeUrl: "https://minecraft.wiki/",
    ownsUrl: url => url.origin === "https://minecraft.wiki",
    resolvePageName: resolveMediaWikiPageName,
    organization: { type: "user-collections" },
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
    return decodePageSlug(slug).replaceAll("_", " ") || "Page";
}
