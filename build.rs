fn main() {
    println!("cargo:rerun-if-changed=always");
    std::process::Command::new("typeshare")
        .current_dir(std::env::var("CARGO_MANIFEST_DIR").unwrap())
        .args([".", "--lang=typescript", "--output-file=frontend/host.d.ts"])
        .status()
        .unwrap();
}
