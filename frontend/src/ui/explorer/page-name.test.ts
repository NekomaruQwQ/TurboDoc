import { describe, expect, test } from "bun:test";
import type { PageName } from "@/core/explorer";
import { getDisplayedSymbolPath, getFullPageName } from "./page-name";

/** A deep namespace makes visual abbreviation and full-name retention distinct. */
const symbol: Extract<PageName, { type: "symbol" }> = {
    type: "symbol",
    separator: "::",
    path: [
        { type: "namespace", name: "windows" },
        { type: "namespace", name: "Win32" },
        { type: "namespace", name: "Graphics" },
        { type: "namespace", name: "Dxgi" },
        { type: "type", name: "IDXGISwapChain" },
    ],
};

describe("symbol name display", () => {
    test.each([undefined, "full"] as const)("reuses the full path for display %j", display => {
        expect(getDisplayedSymbolPath({ ...symbol, display })).toBe(symbol.path);
    });

    test("shows only the leaf while preserving its color and the original path", () => {
        const name = { ...symbol, path: [...symbol.path], display: "leaf" as const };
        Object.freeze(name.path);
        Object.freeze(name);
        expect({ visible: getDisplayedSymbolPath(name), full: name.path }).toEqual({
            visible: [{ type: "type", name: "IDXGISwapChain" }],
            full: symbol.path,
        });
    });

    test("keeps the final namespace identifier for module pages", () => {
        const name = { ...symbol, path: symbol.path.slice(0, -1), display: "leaf" as const };
        expect(getDisplayedSymbolPath(name)).toEqual([{ type: "namespace", name: "Dxgi" }]);
    });

    test("renders a plain dot without replacing canonical module identifiers", () => {
        const name = {
            ...symbol,
            path: symbol.path.slice(0, -1),
            display: { type: "namespace", name: "." } as const,
        };
        Object.freeze(name.path);
        Object.freeze(name.display);
        Object.freeze(name);
        expect({ visible: getDisplayedSymbolPath(name), full: name.path }).toEqual({
            visible: [{ type: "namespace", name: "." }],
            full: symbol.path.slice(0, -1),
        });
        expect(getFullPageName(name)).toBe("windows::Win32::Graphics::Dxgi");
    });

    test("uses the adapter's alias without hardcoding the module marker", () => {
        const name = { ...symbol, display: { type: "namespace", name: "current" } as const };
        expect(getDisplayedSymbolPath(name)).toEqual([{ type: "namespace", name: "current" }]);
    });

    test("allows a display alias with an empty canonical path", () => {
        const name = { ...symbol, path: [], display: { type: "namespace", name: "." } as const };
        expect({ visible: getDisplayedSymbolPath(name), full: getFullPageName(name) })
            .toEqual({ visible: [{ type: "namespace", name: "." }], full: "" });
    });

    test("handles a single identifier without removing it", () => {
        const name = { ...symbol, path: [{ type: "namespace" as const, name: "windows" }], display: "leaf" as const };
        expect(getDisplayedSymbolPath(name)).toEqual(name.path);
    });

    test("keeps empty paths safe for both display and accessibility", () => {
        const name = { ...symbol, path: [], display: "leaf" as const };
        expect({ visible: getDisplayedSymbolPath(name), full: getFullPageName(name) })
            .toEqual({ visible: [], full: "" });
    });
});

describe("full page names", () => {
    test("retains every segment for tooltips and accessible labels with leaf display", () => {
        expect(getFullPageName({ ...symbol, display: "leaf" }))
            .toBe("windows::Win32::Graphics::Dxgi::IDXGISwapChain");
    });

    test("honors the source's separator without knowing its language", () => {
        expect(getFullPageName({ ...symbol, separator: "." }))
            .toBe("windows.Win32.Graphics.Dxgi.IDXGISwapChain");
    });

    test.each(["windows", "Home", "<error>"])("preserves the text label %j", text => {
        expect(getFullPageName({ type: "text", text })).toBe(text);
    });
});
