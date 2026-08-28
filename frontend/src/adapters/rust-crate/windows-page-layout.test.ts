import { describe, expect, test } from "bun:test";
import type { Page } from "@/core/explorer";
import { createWindowsPageLayout } from "./windows-page-layout";

const docsBase = "https://microsoft.github.io/windows-docs-rs/doc/";
const dxgi = "windows/Win32/Graphics/Dxgi";
const direct3D12 = "windows/Win32/Graphics/Direct3D12";

/** Labels deliberately omit namespace information so fixtures verify that
 * placement comes from URLs, while sortKey remains the page-order contract. */
function page(path: string, pinned: boolean | null = true, sortKey = path): Page {
    return {
        name: { type: "text", text: "Display label" },
        sortKey,
        url: `${docsBase}${path}`,
        current: pinned === false,
        pinned,
        setPinned() {},
    };
}

describe("Windows module page layout", () => {
    test("groups pages with crate-relative headings and no editing capabilities", () => {
        const home = page("windows/", null);
        const modulePage = page(`${dxgi}/index.html`, true, "Dxgi");
        const symbol = page(`${dxgi}/struct.IDXGISwapChain.html`, true, "Dxgi::IDXGISwapChain");

        expect(createWindowsPageLayout([symbol, modulePage, home])).toEqual({ blocks: [
            { id: "home", pageUrls: [home.url] },
            {
                id: `module:${dxgi}`,
                titlePath: ["Win32", "Graphics", "Dxgi"],
                pageUrls: [modulePage.url, symbol.url],
            },
        ] });
    });

    test("orders exact modules and their pages independently of input order", () => {
        const common = page(`${dxgi}/Common/struct.DXGI_FORMAT.html`);
        const swapChain = page(`${dxgi}/struct.IDXGISwapChain.html`, true, "IDXGISwapChain");
        const factory = page(`${dxgi}/fn.CreateDXGIFactory.html`, true, "CreateDXGIFactory");
        const device = page(`${direct3D12}/struct.ID3D12Device.html`);
        const result = createWindowsPageLayout([common, swapChain, factory, device]);

        expect(result.blocks.slice(1).map(block => [block.id, block.pageUrls])).toEqual([
            [`module:${direct3D12}`, [device.url]],
            [`module:${dxgi}`, [factory.url, swapChain.url]],
            [`module:${dxgi}/Common`, [common.url]],
        ]);
    });

    test("shows only represented modules without synthesizing ancestors", () => {
        const common = page(`${dxgi}/Common/struct.DXGI_FORMAT.html`, false);
        expect(createWindowsPageLayout([common]).blocks.map(block => block.id)).toEqual([
            "home", `module:${dxgi}/Common`,
        ]);
    });

    test("does not create module blocks for a root-only item", () => {
        const home = page("windows/", null);
        expect(createWindowsPageLayout([home])).toEqual({ blocks: [
            { id: "home", pageUrls: [home.url] },
        ] });
    });

    test("keeps root-level symbols untitled and separate from the home page", () => {
        const home = page("windows/", null);
        const symbol = page("windows/struct.Symbol.html");
        expect(createWindowsPageLayout([symbol, home])).toEqual({ blocks: [
            { id: "home", pageUrls: [home.url] },
            { id: "module:windows", titlePath: [], pageUrls: [symbol.url] },
        ] });
    });

    test("interleaves a preview with pins and keeps its position when pinned", () => {
        const first = page(`${dxgi}/struct.IDXGIAdapter.html`, true, "IDXGIAdapter");
        const preview = page(`${dxgi}/struct.IDXGIFactory.html`, false, "IDXGIFactory");
        const last = page(`${dxgi}/struct.IDXGISwapChain.html`, true, "IDXGISwapChain");
        const before = createWindowsPageLayout([last, first, preview]);
        const after = createWindowsPageLayout([last, { ...preview, pinned: true }, first]);

        expect({ urls: before.blocks[1]?.pageUrls, stable: before }).toEqual({
            urls: [first.url, preview.url, last.url],
            stable: after,
        });
    });

    test.each(["", "/", "/index.html"])("gives module alias %j the same key", suffix => {
        const modulePage = page(`${dxgi}${suffix}`);
        expect(createWindowsPageLayout([modulePage]).blocks[1]).toEqual({
            id: `module:${dxgi}`,
            titlePath: ["Win32", "Graphics", "Dxgi"],
            pageUrls: [modulePage.url],
        });
    });

    test("ignores fragments and queries for placement while preserving targets", () => {
        const target = page(`${dxgi}/struct.IDXGISwapChain.html?search=Present#method.Present`, false);
        expect(createWindowsPageLayout([target]).blocks[1]).toEqual({
            id: `module:${dxgi}`,
            titlePath: ["Win32", "Graphics", "Dxgi"],
            pageUrls: [target.url],
        });
    });

    test("groups Windows docs.rs previews with the published Windows docs", () => {
        const pinned = page(`${dxgi}/struct.IDXGISwapChain.html`);
        const preview = {
            ...page(`${dxgi}/fn.CreateDXGIFactory.html`, false),
            url: `https://docs.rs/windows/0.62.2/${dxgi}/fn.CreateDXGIFactory.html`,
        };
        expect(createWindowsPageLayout([pinned, preview]).blocks[1]?.pageUrls).toEqual([
            preview.url, pinned.url,
        ]);
    });

    test("retains malformed, unknown and foreign paths in an unnamed block", () => {
        const urls = [
            "not a URL",
            `${docsBase}windows/all.html`,
            `${docsBase}${dxgi}/sidebar-items.js`,
            `${docsBase}windows/Win32//Graphics/Dxgi/struct.IDXGISwapChain.html`,
            `${docsBase}windows/Win32/Not%20AModule/index.html`,
            `https://docs.rs/serde/latest/${dxgi}/struct.IDXGISwapChain.html`,
            "https://docs.rs/windows/latest/not_windows/struct.Symbol.html",
            "https://microsoft.github.io/windows-docs-rs/doc-lookalike/windows/Win32/index.html",
            "https://microsoft.github.io.example.com/windows-docs-rs/doc/windows/Win32/index.html",
            "https://user@microsoft.github.io/windows-docs-rs/doc/windows/Win32/index.html",
            "http://microsoft.github.io/windows-docs-rs/doc/windows/Win32/index.html",
        ];
        const pages = urls.map((url, index) => ({
            ...page("", true, index.toString().padStart(2, "0")), url,
        }));
        expect(createWindowsPageLayout(pages)).toEqual({ blocks: [
            { id: "home", pageUrls: [] },
            { id: "", pageUrls: urls },
        ] });
    });

    test("preserves input records and uses URL order to break equal sort keys", () => {
        const directory = Object.freeze(page(`${dxgi}/`, true, "Dxgi"));
        const index = Object.freeze(page(`${dxgi}/index.html`, true, "Dxgi"));
        const pages = Object.freeze([index, directory]);
        const result = createWindowsPageLayout(pages);

        expect({ input: pages, urls: result.blocks[1]?.pageUrls }).toEqual({
            input: [index, directory],
            urls: [directory.url, index.url],
        });
    });
});
