import type { BookOutlineEntry } from "../src/sources/rust-books/outline";

/** Decode the small entity vocabulary emitted by mdBook's TOC renderer. */
function decodeTitle(text: string): string {
    const named: Record<string, string> = {
        amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
        ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘",
    };
    return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, key: string) => {
        if (!key.startsWith("#")) {
            const decoded = named[key];
            if (decoded === undefined) throw new Error(`Unknown title entity: ${entity}`);
            return decoded;
        }
        const code = key[1]?.toLowerCase() === "x"
            ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10);
        if (code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
            throw new Error(`Invalid title entity: ${entity}`);
        return String.fromCodePoint(code);
    }).replace(/\s+/g, " ").replace(/^\s*\d+(?:\.\d+)*\.\s*/, "").trim();
}

/** Read current and older mdBook navigation markup without executing scripts.
 * Only owned, fragment-free HTML chapter links are admitted. A format change
 * fails the refresh instead of replacing a valid snapshot with partial data. */
export function parseBookOutline(html: string, baseUrl: string): BookOutlineEntry[] {
    const base = new URL(baseUrl);
    const entries: BookOutlineEntry[] = [];
    const paths = new Set<string>();
    const ancestors: string[] = [];
    let part = "";
    let linkText = "";
    let headerText = "";
    let lastTitle = "";
    let chapterLists = 0;
    new HTMLRewriter()
        .on("ol.chapter", { element() { chapterLists++; } })
        .on("ol.chapter .part-title", {
            element(element) {
                headerText = "";
                element.onEndTag(() => { part = decodeTitle(headerText); });
            },
            text(chunk) { headerText += chunk.text; },
        })
        .on("ol.chapter ol.section", {
            element(element) {
                if (!lastTitle) throw new Error("Section without a parent chapter");
                ancestors.push(lastTitle);
                element.onEndTag(() => { ancestors.pop(); });
            },
        })
        .on("ol.chapter li.chapter-item a:not(.chapter-fold-toggle)", {
            element(element) {
                const href = element.getAttribute("href");
                if (!href) throw new Error("Chapter link is missing its target");
                const target = new URL(href, base);
                if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname) ||
                    target.username || target.password || target.search || target.hash)
                    throw new Error(`Unowned or ambiguous chapter link: ${href}`);
                const path = target.pathname.slice(base.pathname.length);
                if (!path.endsWith(".html") || path === "toc.html" || path === "print.html")
                    throw new Error(`Not a chapter HTML path: ${href}`);
                if (paths.has(path)) throw new Error(`Duplicate chapter path: ${path}`);
                paths.add(path);
                linkText = "";
                element.onEndTag(() => {
                    const title = decodeTitle(linkText);
                    if (!title) throw new Error(`Empty chapter title: ${path}`);
                    lastTitle = title;
                    entries.push({ path, title, ancestors: [...(part ? [part] : []), ...ancestors] });
                });
            },
            text(chunk) { linkText += chunk.text; },
        }).transform(html);
    if (chapterLists !== 1 || !entries.length || ancestors.length)
        throw new Error("Incomplete or unsupported mdBook outline");
    return entries;
}
