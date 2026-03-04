set shell := ["nu", "-c"]

alias i := install

list:
    just --list
install:
    cd server;   bun i
    cd frontend; bun i
app:
    out/bin/TurboDoc/debug_win-x64/TurboDoc.exe
server:
    TURBODOC_DATA=data bun --hot server
backup:
    cp -f data/workspace.json data/workspace.bak.json
