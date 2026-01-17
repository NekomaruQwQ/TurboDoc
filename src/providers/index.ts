import type { Provider } from "@/core/data";
import * as _ from "remeda";

import RustCrateProvider from "@/providers/rust.crate";

const providers: Provider[] = [
    RustCrateProvider,
];

export default
    _.mapToObj(providers, provider => [provider.id, provider]);
