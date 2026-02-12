set shell := ["nu", "-c"]

default:
    just --list

run script:
    nu scripts/{{script}}.nu
