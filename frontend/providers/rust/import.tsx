import { useState } from "react";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";

import { Button, Modal } from "@heroui/react";
import { useOverlayState } from "@heroui/react";

import type { ProviderAction } from "@/core/data";
import { parseUrl, getBaseUrlForCrate } from "./url";
import type { RustProviderContext } from "./index";

export function getImportCratesAction(ctx: RustProviderContext): ProviderAction {
    return {
        type: "node",
        render() {
            const dialogState = useOverlayState();
            const [importText, setImportText] = useState("");

            function handleImport() {
                const lines =
                    importText
                        .split("\n")
                        .map(line => line.trim())
                        .filter(line => line.length > 0);

                // Parse URLs and group by crate name
                const importCrates: Record<string, string[]> = {};
                for (const line of lines) {
                    if (line.startsWith("https://")) {
                        const page = parseUrl(line);
                        switch (page?.baseUrl) {
                            case "https://docs.rs/":
                            case "https://doc.rust-lang.org/": {
                                const path = page.pathSegments.join("/");
                                const rootModulePath = `${page.name.replaceAll("-", "_")}/`;

                                // Skip root module paths - they're always shown and cannot be pinned.
                                if (path === rootModulePath) {
                                    importCrates[page.name] ??= [];
                                    break;
                                }

                                if (!(importCrates[page.name]?.includes(path))) {
                                    importCrates[page.name] ??= [];
                                    importCrates[page.name]?.push(path);
                                }
                                break;
                            }
                            default:
                                console.log(`[ImportCrates] Unsupported URL: ${line}`);
                                break;
                        }
                    } else {
                        // Try to interpret as crate name.
                        if (/^[a-z0-9_-]+$/i.test(line)) {
                            importCrates[line] ??= [];
                        } else {
                            console.log(`[ImportCrates] Invalid input: ${line}`);
                        }
                    }
                }

                ctx.updateData(draft => {
                    for (const [crateName, newPages] of Object.entries(importCrates)) {
                        // Use "stable" for std crates, "latest" for crates.io crates.
                        const defaultVersion =
                            getBaseUrlForCrate(crateName) === "https://doc.rust-lang.org/"
                                ? "stable"
                                : "latest";
                        draft.crates[crateName] ??= {
                            currentVersion: defaultVersion,
                            pinnedPages: [],
                        };

                        // biome-ignore lint/style/noNonNullAssertion: checked above.
                        const pinnedPages = draft.crates[crateName]!.pinnedPages;
                        for (const page of newPages) {
                            if (!pinnedPages.includes(page)) {
                                pinnedPages.push(page);
                            }
                        }

                        pinnedPages.sort();
                    }
                });

                setImportText("");
                dialogState.close();
            }

            return <>
                <Button
                    variant="secondary"
                    className="w-full h-8 border cursor-pointer"
                    onPress={dialogState.open}>
                    <FontAwesomeIcon icon={faPlus}/>
                    <span>Import</span>
                </Button>
                <Modal state={dialogState}>
                    <Modal.Backdrop />
                    <Modal.Container>
                        <Modal.Dialog>
                            <Modal.Header>
                                <Modal.Heading>Import from URLs</Modal.Heading>
                            </Modal.Header>
                            <Modal.Body>
                                <p className="text-sm text-muted-foreground">
                                    Paste crate names or docs.rs or doc.rust-lang.org URLs (one per line) to add crates and pages.
                                </p>
                                <textarea
                                    value={importText}
                                    onChange={e => setImportText(e.target.value)}
                                    placeholder="https://docs.rs/tokio/latest/tokio/..."
                                    rows={8}
                                    className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                            </Modal.Body>
                            <Modal.Footer>
                                <Button variant="outline" onPress={dialogState.close}>Cancel</Button>
                                <Button onPress={handleImport}>Import</Button>
                            </Modal.Footer>
                        </Modal.Dialog>
                    </Modal.Container>
                </Modal>
            </>
        }
    };
}
