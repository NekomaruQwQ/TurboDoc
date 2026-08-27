import { describe, expect, test } from "bun:test";

import {
    resolveSource,
    type Adapter,
    type SourceDefinition,
    type SourceModel,
} from "./source";

/** Build the smallest runtime model needed to test definition invariants. */
function model(id: string, name: string): SourceModel {
    return {
        id,
        name,
        homeUrl: "https://example.com/",
        presentation: {
            renderItemNameAsCode: false,
            renderPageNameAsCode: false,
        },
        initializeData: () => ({ data: {}, persist: false }),
        matchUrl: () => false,
        render: () => ({ items: {} }),
    };
}

/** Build one data-free definition around a supplied test adapter. */
function definition(adapter: Adapter<object, object>): SourceDefinition<object, object> {
    return { id: "valid-source", name: "Valid Source", adapter, rules: {} };
}

describe("resolveSource", () => {
    test("compiles one definition through its paired adapter", () => {
        const adapter: Adapter<object, object> = {
            resolve: current => model(current.id, current.name),
        };

        expect(resolveSource(definition(adapter)).id).toBe("valid-source");
    });

    test("rejects invalid definition identity before adapter resolution", () => {
        let calls = 0;
        const adapter: Adapter<object, object> = {
            resolve: current => {
                calls++;
                return model(current.id, current.name);
            },
        };

        expect(() => resolveSource({
            ...definition(adapter),
            id: "Invalid/Source",
        })).toThrow("not a valid source identifier");
        expect(() => resolveSource({
            ...definition(adapter),
            name: "   ",
        })).toThrow("must have a display name");
        expect(calls).toBe(0);
    });

    test("rejects an adapter that changes persistence identity", () => {
        const adapter: Adapter<object, object> = {
            resolve: current => model(`${current.id}-changed`, current.name),
        };

        expect(() => resolveSource(definition(adapter)))
            .toThrow("Adapter changed source ID");
    });
});
