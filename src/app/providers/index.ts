import type { Provider } from "@/app/core/data";
import * as _ from "remeda";

import RustProvider from "@/app/providers/rust";

const providers: Provider[] = [
    RustProvider,
];

export default
    _.mapToObj(providers, provider => [provider.id, provider]);
