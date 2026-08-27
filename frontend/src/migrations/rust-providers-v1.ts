import * as z from "zod";

import * as API from "@/core/api";
import {
    EXPLORER_WORKSPACE_DATA_ID,
    explorerWorkspaceDataSchema,
    type ExplorerTopicData,
    type ExplorerWorkspaceData,
} from "@/core/explorerWorkspaceStore.svelte";
import { createItemKey, type ItemKey } from "@/core/itemKey";
import { BOOK_CATALOG } from "@/sources/rust-books/catalog";

/** Legacy root-level Rust Crates provider resource. */
const LEGACY_RUST_CRATE_DATA_ID = "rust";
/** Accepted plural and historical singular Rust Docs resource spellings. */
const LEGACY_RUST_DOC_DATA_IDS = ["rust-docs", "rust-doc"] as const;
/** New independently persisted Rust Crates source. */
const RUST_CRATE_SOURCE_ID = "rust-crates";
/** Topics receiving groups from the two legacy Rust providers. */
const RUST_CRATE_TOPIC_ID = "rust-crates";
const RUST_BOOK_TOPIC_ID = "rust-books";
/** Stable book-source identities that replace the legacy multi-site provider. */
const RUST_BOOK_SOURCE_IDS = BOOK_CATALOG.map(book => book.id);
const RUST_BOOK_SOURCE_ID_SET = new Set(RUST_BOOK_SOURCE_IDS);

const legacyCratesSchema = z.record(z.string().regex(/^[a-z0-9_-]+$/i), z.object({
    currentVersion: z.string(),
    pinnedPages: z.array(z.string()),
}));

const legacyDocDataSchema = z.object({
    sites: z.record(z.string(), z.unknown()).optional(),
});

const legacyDocSiteSchema = z.object({
    pinnedPages: z.array(z.string()),
});

const legacyGroupsSchema = z.record(z.string(), z.object({
    items: z.array(z.string().min(1)),
}));

const legacyGroupOrderSchema = z.array(z.string());

/** Narrow I/O seam that keeps migration policy independently testable. */
export interface RustProvidersV1MigrationIO {
    /** Load a root-level generic data resource. */
    loadDataFile(dataId: string): Promise<API.PersistedResource>;
    /** Load a new per-source resource. */
    loadSourceData(sourceId: string): Promise<API.PersistedResource>;
    /** Write a root-level generic data resource. */
    saveDataFile(dataId: string, data: object): Promise<void>;
    /** Write a new per-source resource. */
    saveSourceData(sourceId: string, data: object): Promise<void>;
}

const defaultIO: RustProvidersV1MigrationIO = {
    loadDataFile: API.loadDataFile,
    loadSourceData: API.loadSourceData,
    saveDataFile: API.saveDataFile,
    saveSourceData: API.saveSourceData,
};

/** Split the two legacy Rust providers into independently persisted sources.
 *
 * Existing source files and existing topic records are independently
 * authoritative. Missing targets are recovered from read-only legacy inputs,
 * allowing both the original migration and a partial prior migration to
 * resume without replacing newer user data.
 */
export async function migrateRustProvidersV1(
    io: RustProvidersV1MigrationIO = defaultIO,
): Promise<void> {
    const initialTargets = await Promise.all([
        io.loadSourceData(RUST_CRATE_SOURCE_ID),
        io.loadDataFile(EXPLORER_WORKSPACE_DATA_ID),
        ...LEGACY_RUST_DOC_DATA_IDS.map(dataId => io.loadDataFile(dataId)),
    ]);
    const rustCrateTarget = initialTargets[0];
    const workspaceTarget = initialTargets[1];
    if (!rustCrateTarget || !workspaceTarget) {
        throw new Error("Legacy Rust migration could not inspect required targets.");
    }

    const workspace = readExistingWorkspace(workspaceTarget);
    const needsRustCrateTopic = workspace !== null &&
        !Object.hasOwn(workspace.topics, RUST_CRATE_TOPIC_ID);
    const needsRustBookTopic = workspace !== null &&
        !Object.hasOwn(workspace.topics, RUST_BOOK_TOPIC_ID);
    const needsLegacyRust = !rustCrateTarget.exists || needsRustCrateTopic;
    const legacyDocCandidates = LEGACY_RUST_DOC_DATA_IDS.map((dataId, index) => ({
        dataId,
        resource: initialTargets[index + 2] ?? { data: {}, exists: false },
    })).filter(candidate => candidate.resource.exists);
    const [legacyRust, bookTargets] = await Promise.all([
        needsLegacyRust
            ? io.loadDataFile(LEGACY_RUST_CRATE_DATA_ID)
            : Promise.resolve(undefined),
        legacyDocCandidates.length === 1
            ? Promise.all(RUST_BOOK_SOURCE_IDS.map(sourceId =>
                io.loadSourceData(sourceId)))
            : Promise.resolve([]),
    ]);
    const missingBookSourceIds = RUST_BOOK_SOURCE_IDS.filter((_, index) =>
        bookTargets[index]?.exists === false);
    const needsLegacyDocs = legacyDocCandidates.length > 1 ||
        missingBookSourceIds.length > 0 || needsRustBookTopic;

    const failures: unknown[] = [];
    const writes: Promise<void>[] = [];
    let legacyRustRoot: Record<string, unknown> | undefined;
    if (legacyRust?.exists) {
        if (isRecord(legacyRust.data)) legacyRustRoot = legacyRust.data;
        else failures.push(new Error("Legacy rust.toml does not contain a TOML table."));
    }

    let legacyDocsRoot: Record<string, unknown> | undefined;
    let legacyDocsName: string | undefined;
    if (legacyDocCandidates.length > 1) {
        failures.push(new Error(
            "Both rust-docs.toml and rust-doc.toml exist; migration cannot choose an authoritative Rust Docs input."));
    } else if (legacyDocCandidates.length === 1) {
        const candidate = legacyDocCandidates[0];
        if (candidate) {
            legacyDocsName = `${candidate.dataId}.toml`;
            if (isRecord(candidate.resource.data)) {
                legacyDocsRoot = candidate.resource.data;
            } else if (needsLegacyDocs) {
                failures.push(new Error(
                    `Legacy ${legacyDocsName} does not contain a TOML table.`));
            }
        } else if (needsLegacyDocs) {
            failures.push(new Error(
                "Legacy Rust Docs input disappeared during migration."));
        }
    }

    if (!rustCrateTarget.exists && legacyRustRoot) {
        const legacyData = isRecord(legacyRustRoot.data)
            ? legacyRustRoot.data
            : undefined;
        const crates = legacyCratesSchema.safeParse(legacyData?.crates);
        if (crates.success) {
            writes.push(io.saveSourceData(RUST_CRATE_SOURCE_ID, {
                schemaVersion: 1,
                crates: crates.data,
            }));
        } else {
            failures.push(new Error(
                "Legacy rust.toml has invalid Rust Crates source data."));
        }
    }

    if (missingBookSourceIds.length > 0 && legacyDocsRoot && legacyDocsName) {
        const legacyData = legacyDocDataSchema.safeParse(legacyDocsRoot.data);
        if (legacyData.success) {
            for (const sourceId of missingBookSourceIds) {
                const site = legacyData.data.sites?.[sourceId];
                if (site === undefined) {
                    writes.push(io.saveSourceData(sourceId, {
                        schemaVersion: 1,
                        pinnedPages: [],
                    }));
                    continue;
                }

                const parsedSite = legacyDocSiteSchema.safeParse(site);
                if (parsedSite.success) {
                    writes.push(io.saveSourceData(sourceId, {
                        schemaVersion: 1,
                        pinnedPages: parsedSite.data.pinnedPages,
                    }));
                } else {
                    failures.push(new Error(
                        `Legacy ${legacyDocsName} has invalid data for Rust book source "${sourceId}".`));
                }
            }
        } else {
            failures.push(new Error(
                `Legacy ${legacyDocsName} has invalid Rust Docs source data.`));
        }
    }

    const workspaceFailures: unknown[] = [];
    let workspaceChanged = false;
    if (workspace && needsRustCrateTopic && legacyRustRoot) {
        const topic = migrateLegacyTopic(
            legacyRustRoot,
            itemId => createItemKey(RUST_CRATE_SOURCE_ID, itemId),
            "rust.toml");
        if (topic instanceof Error) workspaceFailures.push(topic);
        else {
            workspace.topics[RUST_CRATE_TOPIC_ID] = topic;
            workspaceChanged = true;
        }
    }

    if (workspace && needsRustBookTopic && needsLegacyDocs) {
        if (!legacyDocsRoot || !legacyDocsName) {
            if (legacyDocCandidates.length > 0) {
                workspaceFailures.push(new Error(
                    "Legacy Rust Docs groups could not be read safely."));
            }
        } else {
            const topic = migrateLegacyTopic(
                legacyDocsRoot,
                itemId => RUST_BOOK_SOURCE_ID_SET.has(itemId)
                    ? createItemKey(itemId, itemId)
                    : null,
                legacyDocsName);
            if (topic instanceof Error) workspaceFailures.push(topic);
            else {
                workspace.topics[RUST_BOOK_TOPIC_ID] = topic;
                workspaceChanged = true;
            }
        }
    }

    failures.push(...workspaceFailures);
    if (workspace !== null && workspaceChanged && workspaceFailures.length === 0) {
        writes.push(io.saveDataFile(EXPLORER_WORKSPACE_DATA_ID, workspace));
    }

    const results = await Promise.allSettled(writes);
    failures.push(...results.flatMap(result =>
        result.status === "rejected" ? [result.reason] : []));
    if (failures.length > 0) {
        throw new AggregateError(
            failures,
            "Legacy Rust providers migration did not finish every independent write.");
    }
}

/** Return a mutable validated workspace, or null when an existing target is
 * malformed and must remain untouched for its owning store to report. */
function readExistingWorkspace(
    resource: API.PersistedResource,
): ExplorerWorkspaceData | null {
    if (!resource.exists) return { schemaVersion: 1, topics: {} };
    const parsed = explorerWorkspaceDataSchema.safeParse(resource.data);
    return parsed.success ? parsed.data : null;
}

/** Convert one legacy provider's groups into topic-owned composite items. */
function migrateLegacyTopic(
    legacyRoot: Record<string, unknown>,
    createKey: (itemId: string) => ItemKey | null,
    legacyName: string,
): ExplorerTopicData | Error {
    const groups = legacyGroupsSchema.safeParse(legacyRoot.groups);
    const groupOrder = legacyGroupOrderSchema.safeParse(legacyRoot.groupOrder);
    if (!groups.success || !groupOrder.success) {
        return new Error(`Legacy ${legacyName} has invalid Explorer group data.`);
    }

    const migratedGroups = Object.fromEntries(
        Object.entries(groups.data).map(([name, group]) => [name, {
            items: group.items.flatMap(itemId => {
                const key = createKey(itemId);
                return key === null ? [] : [key];
            }),
        }]));
    return {
        groups: migratedGroups,
        groupOrder: normalizeGroupOrder(
            Object.keys(migratedGroups),
            groupOrder.data),
    };
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
