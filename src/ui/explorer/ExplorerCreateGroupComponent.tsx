import type { ComponentProps, ReactNode } from "react";
import { useState } from "react";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faPlus } from "@fortawesome/free-solid-svg-icons";

import { Button } from "@shadcn/components/ui/button";
import { Input } from "@shadcn/components/ui/input";

import { useProviderData } from "@/core/context";

/**
 * Button that transforms into an inline input for creating a new group.
 * - Click "Add Group" → shows input + confirm button
 * - Enter or click check → creates group and resets
 * - Escape or blur → cancels and resets
 */
export default function ExplorerCreateGroupComponent() {
    const [providerData, updateProviderData] = useProviderData();
    const [inputMode, setInputMode] = useState(false);
    const [inputText, setInputText] = useState("");

    function createGroup(groupName: string) {
        updateProviderData(draft => {
            if (groupName && !(groupName in providerData.groups)) {
                draft.groups[groupName] = [];
                draft.groupOrder.push(groupName);
                draft.expandedGroups.push(groupName);
            }
        });
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

    function ActionButton(props: ComponentProps<"button">) {
        return (
            <Button
                variant="secondary"
                size={"custom" as any}
                className={`border size-8 cursor-pointer ${props.className}`}
                {...props} />);
    }

    return (
        <div className="flex flex-row items-center w-full gap-2 mb-2">
            {inputMode ? <>
                <Input
                    value={inputText}
                    placeholder="Group name..."
                    autoFocus
                    onChange={e => setInputText(e.target.value)}
                    onKeyDown={e => e.key ? onOK(e) : onCancel(e)}
                    onBlur={e => onCancel(e)}
                    className="h-8"/>
                {/* Use onMouseDown to prevent onBlur fired before onClick */}
                <ActionButton className="size-8" onMouseDown={e => onOK(e)}>
                    <FontAwesomeIcon icon={faCheck}/>
                </ActionButton>
            </> : <>
                {/* Use onClick to avoid (what?) */}
                <ActionButton className="w-full" onClick={() => setInputMode(true)}>
                    <FontAwesomeIcon icon={faPlus}/>
                    <span>Add Group</span>
                </ActionButton>
            </>}
        </div>);
}
