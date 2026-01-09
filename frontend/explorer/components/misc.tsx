import type { KeyboardEvent, MouseEvent, ReactElement, ReactNode } from "react";
import { useState } from "react";

import { Check, Plus } from "lucide-react";

import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";

import { useAppContext} from "@/context.ts";

/** Wrapper for group action buttons in the header. Used for type-safe slot pattern. */
export function ExplorerGroupActions(props: { children: ReactNode }) {
    return <>{props.children}</>;
}

/**
 * Shared header layout for group sections (ungrouped and named groups).
 * Renders a title with hover-visible action buttons.
 */
export function ExplorerGroupHeaderCommon(props:  {
    title: string;
    /** Action buttons wrapped in ExplorerGroupActions, shown on hover. */
    children?: ReactElement<{ children: ReactNode }, typeof ExplorerGroupActions>;
}) {
    const actions = props.children?.props.children ?? null;
    return (
        <div className='group/header flex flex-row items-center gap-1'>
            <p className='flex-1 text-muted-foreground text-sm font-semibold uppercase'>{props.title}</p>
            <div className='flex flex-row items-center justify-end gap-0.5 text-muted-foreground'>
                {actions}
            </div>
        </div>);
}

/**
 * Button that transforms into an inline input for creating a new group.
 * - Click "Add Group" → shows input + confirm button
 * - Enter or click check → creates group and resets
 * - Escape or blur → cancels and resets
 */
export function CreateGroupComponent() {
    const app = useAppContext();
    const [inputMode, setInputMode] = useState(false);
    const [inputText, setInputText] = useState('');

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
        setInputText('');
        setInputMode(false);
    }

    function onCancel() {
        setInputText('');
        setInputMode(false);
    }

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === 'Enter') {
            onOK();
            return;
        }

        if (e.key === 'Escape') {
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
                variant='secondary'
                size={'custom' as any}
                className={`border w-7 h-7 cursor-pointer ${props.className}`}
                onMouseDown={props.onMouseDown}
                onClick={props.onClick}>
                {props.children}
            </Button>);
    }

    return (
        <div className='flex flex-row items-center w-full gap-2 mb-2'>
            {inputMode ? <>
                <Input
                    value={inputText}
                    placeholder='Group name...'
                    autoFocus
                    onChange={e => setInputText(e.target.value)}
                    onKeyDown={onKeyDown}
                    onBlur={onCancel}
                    className='h-7 text-sm'/>
                {/* Use onMouseDown to prevent onBlur fired before onClick */}
                <ActionButton className='w-7' onMouseDown={e => {
                    e.preventDefault();
                    onOK();
                }}>
                    <Check className='h-3 w-3'/>
                </ActionButton>
            </> : <>
                {/* Use onClick to avoid (what?) */}
                <ActionButton className='w-full' onClick={() => setInputMode(true)}>
                    <Plus className='h-3 w-3'/>
                    <span>Add Group</span>
                </ActionButton>
            </>}
        </div>);
}
