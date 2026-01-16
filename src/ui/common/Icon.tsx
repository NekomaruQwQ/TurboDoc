import type { IconName } from "@/core/data";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

export type IconSize =
    | "xs"
    | "sm"
    | "lg"
    | "xl";

export default function Icon(props: {
    icon: IconName,
    size?: IconSize,
    className?: string,
}) {
    switch (props.icon.type) {
        case "fontawesome":
            return (
            <FontAwesomeIcon
                icon={props.icon.name}
                size={props.size}
                className={props.className} />);
    }
}
