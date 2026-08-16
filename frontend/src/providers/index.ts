import type { Provider } from "@/core/data";

import RustProvider from "@/providers/rust";
import {
    MinecraftWikiProvider,
    RustDocProvider,
    WikipediaProvider,
} from "@/providers/doc/providers";

export default [
    RustProvider,
    RustDocProvider,
    MinecraftWikiProvider,
    WikipediaProvider,
] as Provider[];
