import type { Provider } from "@/core/data";

import RustProvider from "@/providers/rust";
import DocProvider from "@/providers/doc";

export default [
    RustProvider,
    DocProvider,
] as Provider[];
