import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useState } from "react";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faPlus } from "@fortawesome/free-solid-svg-icons";

import { Button } from "@shadcn/components/ui/button";
import { Input } from "@shadcn/components/ui/input";

import { useAppContext } from "@/context";

/**
 * Button that transforms into an inline input for creating a new group.
 * - Click "Add Group" → shows input + confirm button
 * - Enter or click check → creates group and resets
 * - Escape or blur → cancels and resets
 */
export default function ExplorerCreateGroupComponent() {
    const app = useAppContext();
    const [inputMode, setInputMode] = useState(false);
    const [inputText, setInputText] = useState("");

    function onOK() {
        const inputTrimmed = inputText.trim();
        if (inputTrimmed) {
            app.updateWorkspace(draft => {
                draft.groups.push({
                    name: inputTrimmed,
                    items: [],
                    expanded: true,
                });
            });
        }
        setInputText("");
        setInputMode(false);
    }

    function onCancel() {
        setInputText("");
        setInputMode(false);
    }

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            onOK();
            return;
        }

        if (e.key === "Escape") {
            onCancel();
            return;
        }
    }

    function ActionButton(props: {
        className?: string;
        children: ReactNode;
        onMouseDown?: (e: MouseEvent) => void;
        onClick?: (e: MouseEvent) => void;
    }) {
        return (
            <Button
                variant="secondary"
                size={"custom" as any}
                className={`border w-7 h-7 cursor-pointer ${props.className}`}
                onMouseDown={props.onMouseDown}
                onClick={props.onClick}>
                {props.children}
            </Button>);
    }

    return (
        <div className="flex flex-row items-center w-full gap-2 mb-2">
            {inputMode ? <>
                <Input
                    value={inputText}
                    placeholder="Group name..."
                    autoFocus
                    onChange={e => setInputText(e.target.value)}
                    onKeyDown={onKeyDown}
                    onBlur={onCancel}
                    className="h-7 text-sm"/>
                {/* Use onMouseDown to prevent onBlur fired before onClick */}
                <ActionButton className="w-7" onMouseDown={e => {
                    e.preventDefault();
                    onOK();
                }}>
                    <FontAwesomeIcon icon={faCheck} size="sm"/>
                </ActionButton>
            </> : <>
                {/* Use onClick to avoid (what?) */}
                <ActionButton className="w-full" onClick={() => setInputMode(true)}>
                    <FontAwesomeIcon icon={faPlus} size="sm"/>
                    <span>Add Group</span>
                </ActionButton>
            </>}
        </div>);
}
