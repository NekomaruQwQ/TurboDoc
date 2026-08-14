set shell := ["nu", "-c"]

alias r := run
alias i := install

# Run TurboDoc with repository-local data.
dev *args:
    cargo run --release -- --dev --data data {{args}}


# Run TurboDoc in its default release mode with the specified arguments.
run *args:
    cargo run --release -- {{args}}

# Run the specified `svelte-check` command in the frontend directory.
svc *args:
    cd frontend; bunx --bun svelte-check --tsconfig tsconfig.json {{args}}

# Install dependencies and shadcn-svelte components in the frontend directory.
install:
    cd frontend; bun i
    cd frontend; bunx --bun shadcn-svelte@latest add -y --no-deps --overwrite \
        button \
        card \
        dialog \
        dropdown-menu \
        input \
        resizable \
        select \
        separator \
        collapsible

# Build the optimized host and assemble Vite artifacts beside the executable.
release:
    cargo build --release
    cd frontend; bunx --bun vite build
    rm -rf target/release/public
    cp -r frontend/dist target/release/public
