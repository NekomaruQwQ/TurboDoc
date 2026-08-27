import { describe, expect, test } from "bun:test";

import type { PersistedResource } from "@/core/api";
import { createItemKey } from "@/core/itemKey";
import {
    migrateRustProviderV1,
    type RustProviderV1MigrationIO,
} from "./rust-provider-v1";

/** In-memory migration boundary recording every addressed resource. */
function migrationIO(resources: Record<string, PersistedResource>): {
    io: RustProviderV1MigrationIO;
    reads: string[];
    writes: Record<string, object>;
} {
    const reads: string[] = [];
    const writes: Record<string, object> = {};
    return {
        reads,
        writes,
        io: {
            async loadDataFile(id) {
                reads.push(`data:${id}`);
                return resources[`data:${id}`] ?? { data: {}, exists: false };
            },
            async loadSourceData(id) {
                reads.push(`source:${id}`);
                return resources[`source:${id}`] ?? { data: {}, exists: false };
            },
            async saveDataFile(id, data) {
                writes[`data:${id}`] = data;
            },
            async saveSourceData(id, data) {
                writes[`source:${id}`] = data;
            },
        },
    };
}

describe("legacy rust.toml migration", () => {
    test("splits flat source data and topic-owned composite groups", async () => {
        const { io, writes } = migrationIO({
            "data:rust": {
                exists: true,
                data: {
                    data: {
                        crates: {
                            serde: { currentVersion: "latest", pinnedPages: [] },
                        },
                    },
                    groups: {
                        Favorites: { items: ["serde"] },
                        Omitted: { items: [] },
                    },
                    groupOrder: ["Favorites", "Favorites", "unknown"],
                },
            },
        });

        await migrateRustProviderV1(io);

        expect(writes).toEqual({
            "source:rust-crates": {
                schemaVersion: 1,
                crates: {
                    serde: { currentVersion: "latest", pinnedPages: [] },
                },
            },
            "data:ui.explorer": {
                schemaVersion: 1,
                topics: {
                    "rust-crates": {
                        groups: {
                            Favorites: {
                                items: [createItemKey("rust-crates", "serde")],
                            },
                            Omitted: { items: [] },
                        },
                        groupOrder: ["Favorites", "Omitted"],
                    },
                },
            },
        });
    });

    test("treats each existing target as independently authoritative", async () => {
        const { io, writes } = migrationIO({
            "source:rust-crates": { data: { broken: "left alone" }, exists: true },
            "data:rust": {
                exists: true,
                data: {
                    data: { crates: {} },
                    groups: {},
                    groupOrder: [],
                },
            },
        });

        await migrateRustProviderV1(io);

        expect(writes).toEqual({
            "data:ui.explorer": {
                schemaVersion: 1,
                topics: {
                    "rust-crates": { groups: {}, groupOrder: [] },
                },
            },
        });
    });

    test("never queries retired documentation persistence files", async () => {
        const { io, reads } = migrationIO({});

        await migrateRustProviderV1(io);

        expect(reads).toEqual([
            "source:rust-crates",
            "data:ui.explorer",
            "data:rust",
        ]);
    });

    test("does not replace malformed legacy blocks with empty data", async () => {
        const { io, writes } = migrationIO({
            "data:rust": {
                exists: true,
                data: {
                    data: { crates: "invalid" },
                    groups: { Favorites: { items: "invalid" } },
                    groupOrder: [],
                },
            },
        });

        await expect(migrateRustProviderV1(io)).rejects.toThrow(
            "Legacy Rust provider migration did not finish every independent write.");

        expect(writes).toEqual({});
    });
});
