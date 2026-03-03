import type { ComponentProps, KeyboardEvent } from "react";
import { useState } from "react";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faPlus } from "@fortawesome/free-solid-svg-icons";

import { Button } from "@shadcn/components/ui/button";
import { Input } from "@shadcn/components/ui/input";

import { useProviderData, useProviderUiState } from "@/app/core/context";

/**
 * Button that transforms into an inline input for creating a new group.
 * - Click "Add Group" → shows input + confirm button
 * - Enter or click check → creates group and resets
 * - Escape or blur → cancels and resets
 */
export default function ExplorerCreateGroupComponent() {
    const [providerData, updateProviderData] = useProviderData();
    const { updateExpandedGroups } = useProviderUiState();
    const [inputMode, setInputMode] = useState(false);
    const [inputText, setInputText] = useState("");

    function createGroup(groupName: string) {
        if (groupName && !(groupName in providerData.groups)) {
            updateProviderData(draft => {
                draft.groups[groupName] = { items: [] };
                draft.groupOrder.push(groupName);
            });
            // Auto-expand newly created group.
            updateExpandedGroups(draft => {
                draft.push(groupName);
            });
        }
    }

    function onOK(e: { preventDefault(): void; }) {
        e.preventDefault();
        createGroup(inputText.trim());
        setInputText("");
        setInputMode(false);
    }

    function onCancel(e: { preventDefault(): void; }) {
        e.preventDefault();
        setInputText("");
        setInputMode(false);
    }

    function onKeyDown(e: KeyboardEvent) {
        switch (e.key) {
            case "Enter":
                onOK(e);
                break;
            case "Escape":
                onCancel(e);
                break;
        }
    }

    function ActionButton(props: ComponentProps<"button">) {
        // biome-ignore lint/suspicious/noExplicitAny: custom size workaround.
        return <Button variant="secondary" size={"custom" as any} {...props} />;
    }

    return (
        <div className="flex flex-row items-center w-full gap-2">
            {inputMode ? <>
                <Input
                    value={inputText}
                    placeholder="Group name..."
                    autoFocus
                    onChange={e => setInputText(e.target.value)}
                    onKeyDown={onKeyDown}
                    onBlur={e => onCancel(e)}
                    className="h-8"/>
                {/* Use onMouseDown to prevent onBlur fired before onClick */}
                <ActionButton
                    className="size-8 border cursor-pointer"
                    onMouseDown={e => onOK(e)}>
                    <FontAwesomeIcon icon={faCheck}/>
                </ActionButton>
            </> : <>
                {/* Use onClick to avoid (what?) */}
                <ActionButton
                    className="w-full h-8 border cursor-pointer"
                    onClick={() => setInputMode(true)}>
                    <FontAwesomeIcon icon={faPlus}/>
                    <span>Add Group</span>
                </ActionButton>
            </>}
        </div>);
}
