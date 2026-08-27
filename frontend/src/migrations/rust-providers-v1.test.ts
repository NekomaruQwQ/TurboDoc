import { describe, expect, test } from "bun:test";

import type { PersistedResource } from "@/core/api";
import { createItemKey } from "@/core/itemKey";
import { BOOK_CATALOG } from "@/sources/rust-books/catalog";
import {
    migrateRustProvidersV1,
    type RustProvidersV1MigrationIO,
} from "./rust-providers-v1";

/** In-memory migration boundary recording every addressed resource. */
function migrationIO(
    resources: Record<string, PersistedResource>,
    failingWrites: readonly string[] = [],
): {
    io: RustProvidersV1MigrationIO;
    reads: string[];
    writes: Record<string, object>;
    writeAttempts: string[];
} {
    const reads: string[] = [];
    const writes: Record<string, object> = {};
    const writeAttempts: string[] = [];
    const failures = new Set(failingWrites);

    /** Record one write and simulate a selected persistence failure. */
    async function save(key: string, data: object): Promise<void> {
        writeAttempts.push(key);
        if (failures.has(key)) throw new Error(`Failed ${key}`);
        writes[key] = data;
    }

    return {
        reads,
        writes,
        writeAttempts,
        io: {
            async loadDataFile(id) {
                reads.push(`data:${id}`);
                return resources[`data:${id}`] ?? { data: {}, exists: false };
            },
            async loadSourceData(id) {
                reads.push(`source:${id}`);
                return resources[`source:${id}`] ?? { data: {}, exists: false };
            },
            saveDataFile: (id, data) => save(`data:${id}`, data),
            saveSourceData: (id, data) => save(`source:${id}`, data),
        },
    };
}

/** Valid legacy Rust Crates provider data with one grouped crate. */
function legacyRustResource(): PersistedResource {
    return {
        exists: true,
        data: {
            data: {
                crates: {
                    serde: { currentVersion: "latest", pinnedPages: [] },
                },
            },
            groups: { Favorites: { items: ["serde"] } },
            groupOrder: ["Favorites"],
        },
    };
}

/** Valid legacy Rust Docs provider data with representative book pins. */
function legacyDocsResource(): PersistedResource {
    return {
        exists: true,
        data: {
            data: {
                sites: {
                    "rust-book": {
                        pinnedPages: [
                            "https://doc.rust-lang.org/stable/book/ch01-01-installation.html",
                        ],
                    },
                    "cargo-book": {
                        pinnedPages: [
                            "https://doc.rust-lang.org/stable/cargo/commands/cargo-build.html",
                        ],
                    },
                },
            },
            groups: {
                Daily: { items: ["rust-book", "cargo-book", "retired-book"] },
                Omitted: { items: [] },
            },
            groupOrder: ["Daily", "Daily", "unknown"],
        },
    };
}

/** Valid current workspace with caller-selected topic records. */
function workspaceResource(topics: Record<string, object>): PersistedResource {
    return {
        exists: true,
        data: { schemaVersion: 1, topics },
    };
}

describe("legacy Rust provider migration", () => {
    test("splits crates and every Rust book into independent sources", async () => {
        const { io, writes } = migrationIO({
            "data:rust": legacyRustResource(),
            "data:rust-docs": legacyDocsResource(),
        });

        await migrateRustProvidersV1(io);

        expect(writes["source:rust-crates"]).toEqual({
            schemaVersion: 1,
            crates: {
                serde: { currentVersion: "latest", pinnedPages: [] },
            },
        });
        expect(writes["source:rust-book"]).toEqual({
            schemaVersion: 1,
            pinnedPages: [
                "https://doc.rust-lang.org/stable/book/ch01-01-installation.html",
            ],
        });
        expect(writes["source:cargo-book"]).toEqual({
            schemaVersion: 1,
            pinnedPages: [
                "https://doc.rust-lang.org/stable/cargo/commands/cargo-build.html",
            ],
        });
        expect(writes["source:nomicon"]).toEqual({
            schemaVersion: 1,
            pinnedPages: [],
        });
        expect(BOOK_CATALOG.every(book =>
            Object.hasOwn(writes, `source:${book.id}`))).toBeTrue();
        expect(writes["data:ui.explorer"]).toEqual({
            schemaVersion: 1,
            topics: {
                "rust-crates": {
                    groups: {
                        Favorites: {
                            items: [createItemKey("rust-crates", "serde")],
                        },
                    },
                    groupOrder: ["Favorites"],
                },
                "rust-books": {
                    groups: {
                        Daily: {
                            items: [
                                createItemKey("rust-book", "rust-book"),
                                createItemKey("cargo-book", "cargo-book"),
                            ],
                        },
                        Omitted: { items: [] },
                    },
                    groupOrder: ["Daily", "Omitted"],
                },
            },
        });
    });

    test("accepts the historical singular Rust Docs filename", async () => {
        const { io, writes } = migrationIO({
            "source:rust-crates": { data: {}, exists: true },
            "data:ui.explorer": workspaceResource({
                "rust-crates": { groups: {}, groupOrder: [] },
            }),
            "data:rust-doc": legacyDocsResource(),
        });

        await migrateRustProvidersV1(io);

        expect(writes["source:rust-book"]).toEqual({
            schemaVersion: 1,
            pinnedPages: [
                "https://doc.rust-lang.org/stable/book/ch01-01-installation.html",
            ],
        });
        expect(writes["data:ui.explorer"]).toMatchObject({
            topics: {
                "rust-crates": { groups: {}, groupOrder: [] },
                "rust-books": {
                    groups: {
                        Daily: {
                            items: [
                                createItemKey("rust-book", "rust-book"),
                                createItemKey("cargo-book", "cargo-book"),
                            ],
                        },
                    },
                },
            },
        });
    });

    test("preserves existing sources and merges only a missing workspace topic", async () => {
        const existingRustBook = { schemaVersion: 1, pinnedPages: ["kept"] };
        const existingRustCratesTopic = {
            groups: { Existing: { items: [createItemKey("rust-crates", "tokio")] } },
            groupOrder: ["Existing"],
        };
        const existingWikipediaTopic = { groups: {}, groupOrder: [] };
        const { io, reads, writes } = migrationIO({
            "source:rust-crates": { data: {}, exists: true },
            "source:rust-book": { data: existingRustBook, exists: true },
            "data:ui.explorer": workspaceResource({
                "rust-crates": existingRustCratesTopic,
                wikipedia: existingWikipediaTopic,
            }),
            "data:rust-docs": legacyDocsResource(),
        });

        await migrateRustProvidersV1(io);

        expect(reads).not.toContain("data:rust");
        expect(writes).not.toHaveProperty("source:rust-book");
        expect(writes["source:cargo-book"]).toBeDefined();
        expect(writes["data:ui.explorer"]).toMatchObject({
            topics: {
                "rust-crates": existingRustCratesTopic,
                wikipedia: existingWikipediaTopic,
                "rust-books": {
                    groupOrder: ["Daily", "Omitted"],
                },
            },
        });
    });

    test("does not replace an existing Rust Books topic", async () => {
        const existingRustBooksTopic = {
            groups: { Kept: { items: [createItemKey("rust-book", "rust-book")] } },
            groupOrder: ["Kept"],
        };
        const { io, writes } = migrationIO({
            "source:rust-crates": { data: {}, exists: true },
            "data:ui.explorer": workspaceResource({
                "rust-crates": { groups: {}, groupOrder: [] },
                "rust-books": existingRustBooksTopic,
            }),
            "data:rust-docs": legacyDocsResource(),
        });

        await migrateRustProvidersV1(io);

        expect(writes).not.toHaveProperty("data:ui.explorer");
        expect(writes["source:rust-book"]).toBeDefined();
    });

    test("rejects ambiguous Rust Docs inputs without choosing either", async () => {
        const { io, writes } = migrationIO({
            "source:rust-crates": { data: {}, exists: true },
            "data:ui.explorer": workspaceResource({
                "rust-crates": { groups: {}, groupOrder: [] },
            }),
            "data:rust-docs": legacyDocsResource(),
            "data:rust-doc": legacyDocsResource(),
        });

        await expect(migrateRustProvidersV1(io)).rejects.toThrow(
            "Legacy Rust providers migration did not finish every independent write.");

        expect(writes).toEqual({});
    });

    test("isolates malformed book data from other source writes", async () => {
        const docs = legacyDocsResource();
        if (typeof docs.data !== "object" || docs.data === null) throw new Error();
        const providerData = docs.data as {
            data: { sites: Record<string, { pinnedPages: unknown }> };
        };
        providerData.data.sites["rust-book"] = { pinnedPages: "invalid" };
        const { io, writes } = migrationIO({
            "source:rust-crates": { data: {}, exists: true },
            "data:ui.explorer": workspaceResource({
                "rust-crates": { groups: {}, groupOrder: [] },
                "rust-books": { groups: {}, groupOrder: [] },
            }),
            "data:rust-docs": docs,
        });

        await expect(migrateRustProvidersV1(io)).rejects.toThrow(
            "Legacy Rust providers migration did not finish every independent write.");

        expect(writes).not.toHaveProperty("source:rust-book");
        expect(writes["source:cargo-book"]).toBeDefined();
        expect(writes["source:nomicon"]).toEqual({
            schemaVersion: 1,
            pinnedPages: [],
        });
    });

    test("does not materialize workspace when legacy groups are malformed", async () => {
        const docs = legacyDocsResource();
        if (typeof docs.data !== "object" || docs.data === null) throw new Error();
        (docs.data as { groups: unknown }).groups = {
            Daily: { items: "invalid" },
        };
        const { io, writes } = migrationIO({
            "source:rust-crates": { data: {}, exists: true },
            "data:rust-docs": docs,
        });

        await expect(migrateRustProvidersV1(io)).rejects.toThrow(
            "Legacy Rust providers migration did not finish every independent write.");

        expect(writes).not.toHaveProperty("data:ui.explorer");
        expect(writes["source:rust-book"]).toBeDefined();
    });

    test("attempts every independent write before reporting failures", async () => {
        const { io, writeAttempts } = migrationIO({
            "data:rust": legacyRustResource(),
        }, ["source:rust-crates", "data:ui.explorer"]);

        await expect(migrateRustProvidersV1(io)).rejects.toThrow(
            "Legacy Rust providers migration did not finish every independent write.");

        expect(writeAttempts).toContain("source:rust-crates");
        expect(writeAttempts).toContain("data:ui.explorer");
    });

    test("does not inspect book targets when no legacy Rust Docs file exists", async () => {
        const { io, reads } = migrationIO({});

        await migrateRustProvidersV1(io);

        expect(reads).toEqual([
            "source:rust-crates",
            "data:ui.explorer",
            "data:rust-docs",
            "data:rust-doc",
            "data:rust",
        ]);
    });
});
