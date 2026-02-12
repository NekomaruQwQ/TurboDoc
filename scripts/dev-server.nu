let serverDir = ("src/server" | path expand)
let dataDir = ("target/data" | path expand)

TURBODOC_DATA=$dataDir bun --hot $serverDir
