import type { ComponentProps } from "react";
import { useState } from "react";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";

import { Button } from "@shadcn/components/ui/button";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shadcn/components/ui/dialog";

import type { ProviderAction } from "@/core/data";
import { parseUrl } from "./url";
import type { RustCrateProviderContext } from "./index";

export function getImportCratesAction(ctx: RustCrateProviderContext): ProviderAction {
    return {
        type: "node",
        render() {
            function ActionButton(props: ComponentProps<"button">) {
                return (
                    <Button
                        variant="secondary"
                        size={"custom" as any}
                        className={`border size-8 cursor-pointer ${props.className}`}
                        {...props} />);
            }

            const [showDialog, setShowDialog] = useState(false);
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
                                const path = page.pathSegments.join("/");
                                if (!(importCrates[page.crateName]?.includes(path))) {
                                    importCrates[page.crateName] ??= [];
                                    importCrates[page.crateName]!.push(path);
                                }
                                break;
                            default:
                                console.log(`[ImportCrates] Unsupported URL: ${line}`);
                                break;
                        }
                    } else {
                        // Try to interpret as crate name.
                        if (/[a-z0-9-_]+/g.test(line)) {
                            importCrates[line] ??= [];
                        } else {
                            console.log(`[ImportCrates] Invalid input: ${line}`);
                        }
                    }
                }

                ctx.updateData(draft => {
                    for (const [crateName, newPages] of Object.entries(importCrates)) {
                        draft.crates[crateName] ??= {
                            currentVersion: "latest",
                            pinnedPages: [],
                        };

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
                setShowDialog(false);
            }

            return <>
                <div className="flex flex-row items-center w-full gap-2 mb-2">
                    <ActionButton
                        className="w-full h-8 cursor-pointer"
                        onClick={() => setShowDialog(true)}>
                        <FontAwesomeIcon icon={faPlus}/>
                        <span>Import Crates</span>
                    </ActionButton>
                </div>
                <Dialog open={showDialog} onOpenChange={setShowDialog}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Import from URLs</DialogTitle>
                            <DialogDescription>
                                Paste docs.rs URLs (one per line) to add crates and pages.
                            </DialogDescription>
                        </DialogHeader>
                        <textarea
                            value={importText}
                            onChange={e => setImportText(e.target.value)}
                            placeholder="https://docs.rs/tokio/latest/tokio/..."
                            rows={8}
                            className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
                            <Button onClick={handleImport}>Import</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </>
        }
    };
}
