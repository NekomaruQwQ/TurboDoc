import {
    WebAdapter,
    type WebSourceDefinition,
} from "@/adapters/web";
import { resolveSource } from "@/core/source";
import { decodePageSlug } from "@/sources/page-names";

/** English Wikipedia definition, matched by exact HTTPS origin. */
export const WikipediaDefinition = {
    id: "wikipedia",
    name: "Wikipedia",
    adapter: WebAdapter,
    rules: {
        homeUrl: "https://en.wikipedia.org/wiki/Main_Page",
        ownsUrl: (url: URL) => url.origin === "https://en.wikipedia.org",
        resolvePageName: resolveMediaWikiPageName,
    },
} satisfies WebSourceDefinition;

/** Community Minecraft Wiki definition for the English and Chinese origins. */
export const MinecraftWikiDefinition = {
    id: "minecraft-wiki",
    name: "Minecraft Wiki",
    adapter: WebAdapter,
    rules: {
        homeUrl: "https://minecraft.wiki/",
        // Keep exact origins aligned with native HOSTED_URL and PROXIED_URL.
        ownsUrl: (url: URL) => url.origin === "https://minecraft.wiki" ||
            url.origin === "https://zh.minecraft.wiki",
        resolvePageName: resolveMediaWikiPageName,
    },
} satisfies WebSourceDefinition;

/** Independently persisted Minecraft Wiki source model. */
export const MinecraftWikiSource = resolveSource(MinecraftWikiDefinition);

/** Independently persisted English Wikipedia source model. */
export const WikipediaSource = resolveSource(WikipediaDefinition);

/** Extract a MediaWiki article title without live site metadata. */
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
