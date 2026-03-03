set shell := ["nu", "-c"]

list:
    just --list
app:
    ./bin/Debug/TurboDoc.exe
server:
    TURBODOC_DATA=data bun --hot src/server
backup:
    cp -f data/workspace.json data/workspace.bak.json
