import type { KeyboardEvent } from "react";
import { useState } from "react";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faPlus } from "@fortawesome/free-solid-svg-icons";

import { Button, Input } from "@heroui/react";

import { useProvider, useProviderData } from "@/core/context";
import { expandGroup } from "@/core/uiState";

/**
 * Button that transforms into an inline input for creating a new group.
 * - Click "Add Group" → shows input + confirm button
 * - Enter or click check → creates group and resets
 * - Escape or blur → cancels and resets
 */
export default function ExplorerCreateGroupComponent() {
    const providerId = useProvider().id;
    const [providerData, updateProviderData] = useProviderData();
    const [inputMode, setInputMode] = useState(false);
    const [inputText, setInputText] = useState("");

    function createGroup(groupName: string) {
        if (groupName && !(groupName in providerData.groups)) {
            updateProviderData(draft => {
                draft.groups[groupName] = { items: [] };
                draft.groupOrder.push(groupName);
            });
            // Auto-expand newly created group.
            expandGroup(providerId, groupName);
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

    return (
        <div className="flex flex-row items-center w-full gap-1">
            {inputMode ? <>
                <Input
                    value={inputText}
                    placeholder="Group name..."
                    autoFocus
                    onChange={e => setInputText(e.target.value)}
                    onKeyDown={onKeyDown}
                    onBlur={e => onCancel(e)}
                    className="h-8 flex-1 ml-1"/>
                {/* Use onMouseDown to prevent onBlur fired before onClick */}
                <Button
                    variant="secondary"
                    className="size-8 min-w-0 border cursor-pointer"
                    onMouseDown={e => onOK(e)}>
                    <FontAwesomeIcon icon={faCheck}/>
                </Button>
            </> : <>
                <Button
                    variant="secondary"
                    className="w-full h-8 border cursor-pointer"
                    onPress={() => setInputMode(true)}>
                    <FontAwesomeIcon icon={faPlus}/>
                    <span>Add Group</span>
                </Button>
            </>}
        </div>);
}
