import type { ReadonlyDeep } from "type-fest";

import * as _ from "remeda";

import {
    Collapsible,
    CollapsibleContent,
} from "@radix-ui/react-collapsible";

import type { AppData, Item } from "@/core/data";
import type { State } from "@/core/prelude";
import providers from "@/providers";
import {
    ProviderDataProvider,
    ProviderProvider,
    useNavigateTo,
    useProvider,
    useProviderCache,
    useProviderData,
    useProviderDataLoader,
} from "@/core/context";

import { useCurrentUrl, useGroupExpanded } from "@/core/uiState";

import ExplorerItem from "@/ui/explorer/ExplorerItem";
import ExplorerGroupHeader from "@/ui/explorer/ExplorerGroupHeader";
import ExplorerCreateGroupComponent from "@/ui/explorer/ExplorerCreateGroupComponent";

export default function Explorer({ appDataState }: {
    appDataState: State<AppData>,
}) {
    const [appData] = appDataState;
    const preset = appData.presets[appData.currentPreset];
    return (
        <div
            className="flex flex-col w-full h-full gap-1 rounded overflow-y-scroll"
            style={{ scrollbarWidth: "none" }}>
            {preset?.providers
                .map(providerId => providers[providerId])
                .map(provider => provider && (
                    <ProviderProvider key={provider.id} value={provider}>
                        <ExplorerProvider />
                    </ProviderProvider>
                ))}
        </div>);
}

function ExplorerProvider() {
    const navigateTo = useNavigateTo();
    const provider = useProvider();
    const providerDataState = useProviderDataLoader();
    const [providerData, updateProviderData] = providerDataState;
    const [cache, updateCache] = useProviderCache();
    const [currentUrl] = useCurrentUrl();

    const providerContext = {
        data: providerData?.data ?? {},
        updateData: (updater: (draft: unknown) => void) => {
            updateProviderData(draft => updater(draft.data));
        },
        cache,
        updateCache: (updater: (draft: unknown) => void) => {
            updateCache(draft => { updater(draft); });
        },
        currentUrl,
        navigateTo,
    };

    const providerOutput = provider.render(providerContext);
    const providerActionNodes =
        providerOutput.actions?.map(action => (
            action.type === "node" ? action.render() : undefined
        )) ?? [];
    return provider &&
        <ProviderDataProvider value={providerDataState}>
        <div className="flex flex-col gap-2 mb-2">
            {...providerActionNodes}
            {provider.enableItemGrouping ? <>
                <ExplorerGroup
                    variant="ungrouped"
                    providerOutput={providerOutput} />
                {providerData?.groupOrder
                    .filter(groupName => groupName in providerData.groups)
                    .map(groupName => (
                        <ExplorerGroup
                            key={groupName}
                            variant="default"
                            groupName={groupName}
                            providerOutput={providerOutput} />
                    ))}
                <ExplorerCreateGroupComponent />
            </> :
                Object
                    .entries(providerOutput.items)
                    .map(([itemId, item]) => (
                        <ExplorerItem
                            key={itemId}
                            item={item}
                            itemGroupName="" />))}
        </div>
        </ProviderDataProvider>;
}

function ExplorerGroup(props: ReadonlyDeep<{
    providerOutput: ReadonlyDeep<{ items: Record<string, Item>}>,
} & (
    | { variant: "default", groupName: string }
    | { variant: "ungrouped" })>) {
    function renderItem([itemId, item]: ReadonlyDeep<[string, Item]>) {
        return (
            <ExplorerItem
                key={itemId}
                item={item}
                itemGroupName={props.variant === "default" ? props.groupName : ""} />
        );
    }

    const [providerData] = useProviderData();
    const [expanded, setExpanded] = useGroupExpanded(
        useProvider().id,
        props.variant === "default" ? props.groupName : "__ungrouped__");
    return props.variant === "ungrouped"
        ? <>
            <ExplorerGroupHeader
                variant="ungrouped"
                expanded={expanded}
                setExpanded={setExpanded} />
            {_.pipe(
                _.entries(props.providerOutput.items),
                _.filter(([itemId, __]) => (
                    !Object
                        .entries(providerData.groups)
                        .some(([_, group]) => group.items.includes(itemId)))),
                _.sortBy(([_, item]) => item.sortKey),
                _.map(renderItem))}
        </>
        : <Collapsible open={expanded}>
            <ExplorerGroupHeader
                variant="default"
                groupName={props.groupName}
                expanded={expanded}
                setExpanded={setExpanded} />
            <CollapsibleContent className="collapsible-content flex flex-col gap-2">
                {_.pipe(
                    _.entries(props.providerOutput.items),
                    _.filter(([itemId, __]) => (
                        providerData
                            .groups[props.groupName]?.items
                            .includes(itemId)
                        ?? false)),
                    _.sortBy(([_, item]) => item.sortKey),
                    _.map(renderItem))}
            </CollapsibleContent>
        </Collapsible>;
}
