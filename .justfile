set shell := ["nu", "-c"]

alias r := run
alias i := install

run:
    just cargo run
check:
    just cargo clippy
    cd server;   bun i
    cd frontend; bun i
    cd server;   bunx --bun tsc --noEmit
    cd frontend; bunx --bun svelte-check --tsconfig tsconfig.json --threshold error
install:
    just cargo build
    cd server;   bun i
    cd frontend; bun i
    cd frontend; bunx --bun shadcn-svelte@latest add -y --no-deps --overwrite button card dialog dropdown-menu input resizable select separator collapsible

# Run the specified `bun` command in the frontend directory.
bun *args:
    cd frontend; bun {{args}}
# Run the specified `tsc` command in the frontend directory.
tsc *args:
    cd frontend; bunx --bun tsc --noEmit {{args}}
# Run the specified `svelte-check` command in the frontend directory.
svc *args:
    cd frontend; bunx --bun svelte-check --tsconfig tsconfig.json {{args}}
# Run the specified `cargo` command.
cargo command *args:
    cargo {{command}} --release {{args}}
