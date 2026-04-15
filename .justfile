set shell := ["nu", "-c"]

alias r := run
alias i := install

list:
    just --list
run:
    cargo run
check:
    cargo clippy
    cd server;   bun i
    cd frontend; bun i
    cd server;   bunx --bun tsc --noEmit
    cd frontend; bunx --bun tsc --noEmit
install:
    cargo build
    cd server;   bun i
    cd frontend; bun i
