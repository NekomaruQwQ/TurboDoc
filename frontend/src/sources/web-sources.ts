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

/** English Minecraft Wiki definition, retaining its existing persistence ID. */
export const MinecraftWikiDefinition = {
    id: "minecraft-wiki",
    name: "Minecraft Wiki (English)",
    adapter: WebAdapter,
    rules: {
        homeUrl: "https://minecraft.wiki/",
        // Keep exact origins aligned with native HOSTED_URL and PROXIED_URL.
        ownsUrl: (url: URL) => url.origin === "https://minecraft.wiki",
        resolvePageName: resolveMediaWikiPageName,
    },
} satisfies WebSourceDefinition;

/** Chinese Minecraft Wiki definition; query variants remain within this source. */
export const MinecraftWikiChineseDefinition = {
    id: "minecraft-wiki-zh",
    name: "Minecraft Wiki (中文)",
    adapter: WebAdapter,
    rules: {
        homeUrl: "https://zh.minecraft.wiki/",
        ownsUrl: (url: URL) => url.origin === "https://zh.minecraft.wiki",
        resolvePageName: resolveMediaWikiPageName,
    },
} satisfies WebSourceDefinition;

/** Independently persisted English Minecraft Wiki source model. */
export const MinecraftWikiSource = resolveSource(MinecraftWikiDefinition);

/** Independently persisted Chinese Minecraft Wiki source model. */
export const MinecraftWikiChineseSource = resolveSource(MinecraftWikiChineseDefinition);

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
