import { useState, useEffect } from 'react';
import type { ReadonlyDeep } from 'type-fest';

import type { Item, CrateInfo } from '@/data';
import { useAppContext } from '@/context';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { ExternalLink } from 'lucide-react';

interface CrateCardProps {
    /** The item to render. Caller guarantees item.type === 'crate'. */
    item: ReadonlyDeep<Item>;
}

/**
 * Displays a crate as a collapsible card.
 *
 * When collapsed, shows only the crate name.
 * When expanded, shows external links, version, and page list.
 */
export function CrateCard({ item }: CrateCardProps) {
    const ctx = useAppContext();
    const crate = item.data;
    const crateName = crate.name;

    // Fetch crate info (versions, links) - cached by AppContext
    const [crateInfo, setCrateInfo] = useState<ReadonlyDeep<CrateInfo> | undefined>();
    useEffect(() => {
        ctx.getCrateInfo(crateName).then(setCrateInfo);
    }, [crateName]);

    const homeUrl = `https://docs.rs/${crate.name}/${crate.currentVersion}/`;

    return (
        <div className="px-2 py-1 rounded bg-accent shadow-card cursor-pointer">
            <Collapsible open={item.expanded}>
                <CollapsibleTrigger asChild>
                    <p className="font-mono opacity-90">{crateName}</p>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2 pl-2 space-y-1">
                    {/* Header row: links + version */}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {crateInfo?.links.repository && (
                            <a
                                href={crateInfo.links.repository}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-foreground"
                                onClick={e => e.stopPropagation()}>
                                <ExternalLink className="h-3 w-3" />
                            </a>
                        )}
                        <span>{crate.currentVersion}</span>
                    </div>
                    {/* PageList will go here */}
                </CollapsibleContent>
            </Collapsible>
        </div>
    );
}
