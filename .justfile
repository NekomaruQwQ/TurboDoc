set shell := ["nu", "-c"]

alias i := install

list:
    just --list
run:
    cargo run
install:
    cd server;   bun i
    cd frontend; bun i
check:
    cargo clippy
    cd server;   bunx --bun tsc --noEmit
    cd frontend; bunx --bun tsc --noEmit
build:
    dotnet build
    cargo  build
unlock:
    rm -f target/data/lock.toml
