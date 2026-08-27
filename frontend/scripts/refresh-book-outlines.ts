import { BOOK_CATALOG } from "../src/sources/rust-books/catalog";
import type { BookOutlineSnapshot } from "../src/sources/rust-books/outline";
import { parseBookOutline } from "./book-outline-import";

/** Explicit maintenance operation: no application/build import invokes this.
 * Fetch and validate the whole catalog before touching the existing snapshot. */
async function refreshBookOutlines(): Promise<void> {
    const snapshots: Record<string, BookOutlineSnapshot> = {};
    for (const book of BOOK_CATALOG) {
        const sourceUrl = new URL("toc.html", book.baseUrl).href;
        const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`${book.id}: HTTP ${response.status}`);
        if (response.url !== sourceUrl) throw new Error(`${book.id}: unexpected redirect to ${response.url}`);
        const entries = parseBookOutline(await response.text(), book.baseUrl);
        snapshots[book.id] = { sourceUrl, retrievedAt: new Date().toISOString(), entries };
        console.log(`${book.id}: ${entries.length} pages`);
    }
    const output = new URL("../src/sources/rust-books/outlines.generated.json", import.meta.url);
    await Bun.write(output, `${JSON.stringify(snapshots, null, 2)}\n`);
    console.log(`Updated ${BOOK_CATALOG.length} book outlines.`);
}

await refreshBookOutlines();
