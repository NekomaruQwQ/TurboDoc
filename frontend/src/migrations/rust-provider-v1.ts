import * as z from "zod";

import * as API from "@/core/api";
import { EXPLORER_WORKSPACE_DATA_ID } from "@/core/explorerWorkspaceStore.svelte";
import { createItemKey } from "@/core/itemKey";

/** Legacy root-level provider resource read only by this removable migration. */
const LEGACY_RUST_DATA_ID = "rust";
/** New independently persisted Rust crate source. */
const RUST_CRATE_SOURCE_ID = "rust-crates";
/** Topic receiving legacy Rust provider groups. */
const RUST_CRATE_TOPIC_ID = "rust-crates";

const legacyCratesSchema = z.record(z.string().regex(/^[a-z0-9_-]+$/i), z.object({
    currentVersion: z.string(),
    pinnedPages: z.array(z.string()),
}));

const legacyGroupsSchema = z.record(z.string(), z.object({
    items: z.array(z.string().min(1)),
}));

const legacyGroupOrderSchema = z.array(z.string());

/** Narrow I/O seam that keeps migration policy independently testable. */
export interface RustProviderV1MigrationIO {
    /** Load a root-level generic data resource. */
    loadDataFile(dataId: string): Promise<API.PersistedResource>;
    /** Load a new per-source resource. */
    loadSourceData(sourceId: string): Promise<API.PersistedResource>;
    /** Write a root-level generic data resource. */
    saveDataFile(dataId: string, data: object): Promise<void>;
    /** Write a new per-source resource. */
    saveSourceData(sourceId: string, data: object): Promise<void>;
}

const defaultIO: RustProviderV1MigrationIO = {
    loadDataFile: API.loadDataFile,
    loadSourceData: API.loadSourceData,
    saveDataFile: API.saveDataFile,
    saveSourceData: API.saveSourceData,
};

/** Migrate only legacy `<dataDir>/rust.toml` into the source/topic split.
 *
 * Each target is independently authoritative. Existing targets are never
 * parsed or replaced here; this allows a partial prior migration to resume.
 * The legacy file is read-only and remains available for rollback/removal.
 */
export async function migrateRustProviderV1(
    io: RustProviderV1MigrationIO = defaultIO,
): Promise<void> {
    const [sourceTarget, workspaceTarget] = await Promise.all([
        io.loadSourceData(RUST_CRATE_SOURCE_ID),
        io.loadDataFile(EXPLORER_WORKSPACE_DATA_ID),
    ]);
    if (sourceTarget.exists && workspaceTarget.exists) return;

    const legacy = await io.loadDataFile(LEGACY_RUST_DATA_ID);
    if (!legacy.exists || !isRecord(legacy.data)) return;

    const writes: Promise<void>[] = [];
    const failures: unknown[] = [];
    if (!sourceTarget.exists) {
        const legacyData = isRecord(legacy.data.data) ? legacy.data.data : undefined;
        const crates = legacyCratesSchema.safeParse(legacyData?.crates);
        if (crates.success) {
            writes.push(io.saveSourceData(RUST_CRATE_SOURCE_ID, {
                schemaVersion: 1,
                crates: crates.data,
            }));
        } else {
            failures.push(new Error(
                "Legacy rust.toml has invalid Rust crate source data."));
        }
    }

    if (!workspaceTarget.exists) {
        const groups = legacyGroupsSchema.safeParse(legacy.data.groups);
        const groupOrder = legacyGroupOrderSchema.safeParse(legacy.data.groupOrder);
        if (groups.success && groupOrder.success) {
            const migratedGroups = Object.fromEntries(
                Object.entries(groups.data).map(([name, group]) => [name, {
                    items: group.items.map(itemId =>
                        createItemKey(RUST_CRATE_SOURCE_ID, itemId)),
                }]));
            writes.push(io.saveDataFile(EXPLORER_WORKSPACE_DATA_ID, {
                schemaVersion: 1,
                topics: {
                    [RUST_CRATE_TOPIC_ID]: {
                        groups: migratedGroups,
                        groupOrder: normalizeGroupOrder(
                            Object.keys(migratedGroups),
                            groupOrder.data),
                    },
                },
            }));
        } else {
            failures.push(new Error(
                "Legacy rust.toml has invalid Rust Explorer group data."));
        }
    }

    const results = await Promise.allSettled(writes);
    failures.push(...results.flatMap(result =>
        result.status === "rejected" ? [result.reason] : []));
    if (failures.length > 0) {
        throw new AggregateError(
            failures,
            "Legacy Rust provider migration did not finish every independent write.");
    }
}

/** Keep valid legacy order, remove duplicates, then retain omitted groups. */
function normalizeGroupOrder(
    groupNames: readonly string[],
    legacyOrder: readonly string[],
): string[] {
    const known = new Set(groupNames);
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const name of legacyOrder) {
        if (!known.has(name) || seen.has(name)) continue;
        seen.add(name);
        ordered.push(name);
    }
    return [...ordered, ...groupNames.filter(name => !seen.has(name))];
}

/** Narrow unknown JSON values without allowing arrays as key/value records. */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
