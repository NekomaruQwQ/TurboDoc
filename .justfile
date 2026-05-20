set shell := ["nu", "-c"]

alias r := run
alias i := install

# Run TurboDoc with existing data in the local repository.
dev:
    cargo run -- --data data

# Run TurboDoc with the specified arguments.
run *args:
    cargo run -- {{args}}

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

