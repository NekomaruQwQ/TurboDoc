//! SQLite-backed cache storage.
//!
//! Houses the `http_cache` table. The legacy `crates_cache` table is dropped
//! on startup; all upstream resources now use the same RFC-aware cache.
//!
//! Concurrency model: a single `rusqlite::Connection` behind a `Mutex`.
//! `prepare_cached` reuses compiled statements across calls, and WAL lets
//! readers and writers proceed independently at the SQLite layer. For a
//! single-user local cache the lock is rarely contended — switch to a pool
//! (e.g. r2d2-sqlite) only if profiling shows it.
//!
//! Async handlers call into this module via `query`, which dispatches to
//! `tokio::task::spawn_blocking` so the runtime's reactor threads are never
//! blocked on disk I/O.

use std::path::Path;
use std::sync::Arc;
use std::sync::Mutex;

use rusqlite::Connection;

/// Combined schema for all server-owned tables. `IF NOT EXISTS` keeps the
/// `CREATE` idempotent; `DROP TABLE IF EXISTS crates_cache` cleans up the
/// legacy dedicated-crates-cache table (data now lives in `http_cache`).
const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS http_cache (
    url TEXT PRIMARY KEY,
    policy TEXT,
    status_code INTEGER NOT NULL,
    content_type TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    response_headers TEXT NOT NULL DEFAULT '[]',
    body BLOB,
    last_accessed INTEGER NOT NULL,
    last_fetched INTEGER NOT NULL
);

DROP TABLE IF EXISTS crates_cache;
"#;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    /// Open `cache.sqlite` under `data_dir`, enabling WAL and applying the
    /// schema. The caller is responsible for ensuring `data_dir` exists.
    pub fn open(data_dir: &Path) -> anyhow::Result<Arc<Self>> {
        let path = data_dir.join("cache.sqlite");
        let conn = Connection::open(&path)?;
        // WAL lets the proxy revalidator (writer) and inbound GETs (readers)
        // proceed without blocking each other.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.execute_batch(SCHEMA)?;
        migrate_schema(&conn)?;
        log::info!("opened cache.sqlite at {}", path.display());
        Self::log_table_counts(&conn);
        Ok(Arc::new(Self { conn: Mutex::new(conn) }))
    }

    /// Dispatch a synchronous SQLite query onto the blocking thread pool.
    /// Cheap to call from async code; expensive to call in a hot loop.
    pub async fn query<F, R>(self: &Arc<Self>, f: F) -> R
    where
        F: FnOnce(&Connection) -> R + Send + 'static,
        R: Send + 'static,
    {
        let db = Arc::clone(self);
        tokio::task::spawn_blocking(move || {
            let conn = db.conn.lock().expect("DB mutex poisoned");
            f(&conn)
        }).await.expect("DB blocking task panicked")
    }

    fn log_table_counts(conn: &Connection) {
        match conn.query_row("SELECT COUNT(*) FROM http_cache", [], |row| row.get::<_, i64>(0)) {
            Ok(count) => log::info!("  http_cache: {count} entries"),
            Err(err) => log::warn!("  http_cache: count failed ({err})"),
        }
    }
}

/// Add columns introduced after the initial Rust cache schema without
/// discarding offline documentation bodies.
fn migrate_schema(conn: &Connection) -> rusqlite::Result<()> {
    let has_response_headers: bool =
        conn.query_row(
            "SELECT EXISTS(\
                 SELECT 1 FROM pragma_table_info('http_cache') \
                 WHERE name = 'response_headers')",
            [],
            |row| row.get(0))?;
    if !has_response_headers {
        conn.execute(
            "ALTER TABLE http_cache \
             ADD COLUMN response_headers TEXT NOT NULL DEFAULT '[]'",
            [])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const LEGACY_SCHEMA: &str = r#"
CREATE TABLE http_cache (
    url TEXT PRIMARY KEY,
    policy TEXT,
    status_code INTEGER NOT NULL,
    content_type TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    body BLOB,
    last_accessed INTEGER NOT NULL,
    last_fetched INTEGER NOT NULL
);
"#;

    #[test]
    fn migrates_legacy_cache_without_deleting_rows() {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        conn.execute_batch(LEGACY_SCHEMA).expect("create legacy schema");
        conn.execute(
            "INSERT INTO http_cache \
                 (url, policy, status_code, body, last_accessed, last_fetched) \
             VALUES ('https://example.test/', '{}', 200, X'0102', 1, 1)",
            []).expect("insert legacy row");

        migrate_schema(&conn).expect("migrate legacy schema");

        let (headers, body): (String, Vec<u8>) =
            conn.query_row(
                "SELECT response_headers, body FROM http_cache",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)))
                .expect("read migrated row");
        assert_eq!(headers, "[]");
        assert_eq!(body, [1, 2]);
    }

    #[test]
    fn migration_is_idempotent_for_current_schema() {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        conn.execute_batch(SCHEMA).expect("create current schema");

        migrate_schema(&conn).expect("first migration");
        migrate_schema(&conn).expect("second migration");

        let count: i64 =
            conn.query_row(
                "SELECT COUNT(*) FROM pragma_table_info('http_cache') \
                 WHERE name = 'response_headers'",
                [],
                |row| row.get(0))
                .expect("count response_headers columns");
        assert_eq!(count, 1);
    }
}
