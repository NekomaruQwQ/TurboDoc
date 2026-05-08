set shell := ["nu", "-c"]

alias r := run
alias i := install

run:
    cargo run -- --data data
check:
    just install
    cargo clippy
    cd server;   bunx --bun tsc --noEmit
    cd frontend; bunx --bun svelte-check --tsconfig tsconfig.json --threshold error
install:
    cargo build
    cd server;   bun i
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

# Run the specified `svelte-check` command in the frontend directory.
svc *args:
    cd frontend; bunx --bun svelte-check --tsconfig tsconfig.json {{args}}
