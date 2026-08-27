import { describe, expect, test } from "bun:test";

import {
    reconcileExplorerTopicItems,
    reconcileExplorerWorkspaceTopics,
    type ExplorerTopicData,
    type ExplorerWorkspaceData,
} from "@/core/explorerWorkspaceStore.svelte";
import { createItemKey } from "@/core/itemKey";

describe("Explorer workspace reconciliation", () => {
    test("removes retired topics and repairs group order", () => {
        const data: ExplorerWorkspaceData = {
            schemaVersion: 1,
            topics: {
                current: {
                    groups: {
                        First: { items: [] },
                        MissingFromOrder: { items: [] },
                    },
                    groupOrder: ["First", "deleted", "First"],
                },
                retired: {
                    groups: {},
                    groupOrder: [],
                },
            },
        };

        expect(reconcileExplorerWorkspaceTopics(data, ["current"])).toBeTrue();
        expect(data).toEqual({
            schemaVersion: 1,
            topics: {
                current: {
                    groups: {
                        First: { items: [] },
                        MissingFromOrder: { items: [] },
                    },
                    groupOrder: ["First", "MissingFromOrder"],
                },
            },
        });
        expect(reconcileExplorerWorkspaceTopics(data, ["current"])).toBeFalse();
    });

    test("prunes only identities proven stale by the source registry", () => {
        const readyValid = createItemKey("ready", "valid");
        const readyStale = createItemKey("ready", "stale");
        const unavailable = createItemKey("unavailable", "preserved");
        const retired = createItemKey("retired", "removed");
        const topicData: ExplorerTopicData = {
            groups: {
                Group: {
                    items: [
                        readyValid,
                        readyStale,
                        unavailable,
                        retired,
                        readyValid,
                    ],
                },
            },
            groupOrder: ["Group"],
        };
        const evidence = {
            registeredSourceIds: ["ready", "unavailable"],
            readySourceIds: ["ready"],
            validItemIds: [readyValid],
        };

        expect(reconcileExplorerTopicItems(topicData, evidence)).toBeTrue();
        expect(topicData.groups.Group?.items).toEqual([
            readyValid,
            unavailable,
        ]);
        expect(reconcileExplorerTopicItems(topicData, evidence)).toBeFalse();
    });
});
