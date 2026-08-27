import {
    RustCrateAdapter,
    type RustCrateSourceDefinition,
} from "@/adapters/rust-crate";
import { resolveSource } from "@/core/source";

/** Code-defined Rust crate source paired with its only meaningful adapter. */
export const RustCrateDefinition: RustCrateSourceDefinition = {
    id: "rust-crates",
    name: "Rust Crates",
    adapter: RustCrateAdapter,
    rules: {
        homeUrl: "https://docs.rs/",
        starterCrates: ["serde", "tokio"],
    },
};

/** Runtime Rust crate source model compiled from the definition. */
export const RustCrateSource = resolveSource(RustCrateDefinition);
