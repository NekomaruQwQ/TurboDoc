import { describe, expect, test } from "bun:test";

import { buildVersionMenuChoices } from "./version-menu";

describe("buildVersionMenuChoices", () => {
    test("keeps five recommended choices at the menu's first level", () => {
        const result = buildVersionMenuChoices({
            current: "latest",
            recommended: ["latest", "2.0.0", "1.5.0", "1.4.0", "1.3.0", "1.2.0"],
            all: [
                ["latest"],
                ["2.0.0"],
                ["1.5.0", "1.5.1"],
                ["1.4.0"],
                ["1.3.0"],
                ["1.2.0"],
            ],
        });

        expect(result.direct).toEqual(["latest", "2.0.0", "1.5.0", "1.4.0", "1.3.0"]);
    });

    test("preserves compatibility groups in the overflow", () => {
        const result = buildVersionMenuChoices({
            current: "latest",
            recommended: ["latest", "2.0.0", "1.5.1", "1.4.0", "1.3.0"],
            all: [
                ["latest"],
                ["2.0.0"],
                ["1.5.1", "1.5.0"],
                ["1.4.0"],
                ["1.3.0"],
                ["1.2.0", "1.2.0"],
            ],
        });

        expect(result.overflowGroups).toEqual([["1.5.0"], ["1.2.0"]]);
    });

    test("retains an exceptional current version in the overflow", () => {
        const result = buildVersionMenuChoices({
            current: "legacy-channel",
            recommended: ["latest", "2.0.0", "1.5.0", "1.4.0", "1.3.0", "legacy-channel"],
            all: [["latest"], ["2.0.0"], ["1.5.0"], ["1.4.0"], ["1.3.0"]],
        });

        expect(result.overflowGroups).toEqual([["legacy-channel"]]);
    });

    test("fills unused direct slots from the full history", () => {
        const result = buildVersionMenuChoices({
            current: "latest",
            recommended: ["latest", "2.0.0"],
            all: [["latest"], ["2.0.0", "1.5.0", "1.4.0", "1.3.0", "1.2.0"]],
        });

        expect(result.direct).toEqual(["latest", "2.0.0", "1.5.0", "1.4.0", "1.3.0"]);
    });

    test("omits the overflow when every version is direct", () => {
        const result = buildVersionMenuChoices({
            current: "stable",
            recommended: ["stable", "nightly"],
            all: [["stable", "nightly"]],
        });

        expect(result.overflowGroups).toEqual([]);
    });
});
