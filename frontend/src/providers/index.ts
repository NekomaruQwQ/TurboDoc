import type { Provider } from "@/core/data";
import * as _ from "remeda";

import RustProvider from "@/providers/rust";

const providers: Provider[] = [
    RustProvider,
];

export default
    _.mapToObj(providers, provider => [provider.id, provider]);
