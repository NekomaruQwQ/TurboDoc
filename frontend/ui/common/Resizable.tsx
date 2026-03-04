import * as React from "react";
import * as Primitive from "react-resizable-panels";

import { cn } from "@/core/prelude";

/** Thin wrappers around `react-resizable-panels` for consistent styling. */

export function ResizablePanelGroup({
    className,
    ...props
}: React.ComponentProps<typeof Primitive.PanelGroup>) {
    return (
        <Primitive.PanelGroup
            className={cn(
                "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
                className)}
            {...props} />);
}

export function ResizablePanel(props: React.ComponentProps<typeof Primitive.Panel>) {
    return <Primitive.Panel {...props} />;
}

export function ResizableHandle({
    className,
    ...props
}: React.ComponentProps<typeof Primitive.PanelResizeHandle>) {
    return (
        <Primitive.PanelResizeHandle
            className={cn(
                "bg-border focus-visible:ring-focus relative flex w-px items-center justify-center after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-hidden data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:translate-x-0 data-[panel-group-direction=vertical]:after:-translate-y-1/2",
                className)}
            {...props} />);
}
