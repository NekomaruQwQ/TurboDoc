set shell := ["nu", "-c"]

alias r := run
alias c := check
alias i := install

run:
    cargo run -- --data data --dev
check:
    cargo clippy
    cd frontend; bunx --bun svelte-check --tsconfig tsconfig.json --threshold error
install:
    cargo build
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
