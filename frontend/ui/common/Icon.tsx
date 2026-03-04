import type { ReadonlyDeep } from "type-fest";
import type { IconProp } from "@/core/data";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { castDraft } from "immer";

export type IconSize =
    | "xs"
    | "sm"
    | "lg"
    | "xl";

export default function Icon(props: ReadonlyDeep<{
    icon: IconProp,
    size?: IconSize,
    className?: string,
}>) {
    switch (props.icon.type) {
        case "fontawesome":
            return (
            <FontAwesomeIcon
                icon={castDraft(props.icon.name)}
                size={props.size}
                className={props.className} />);
    }
}
