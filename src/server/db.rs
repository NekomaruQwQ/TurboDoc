//! SQLite-backed cache storage.
//!
//! Houses the `http_cache` and `crates_cache` tables. The schema matches the
//! former Bun server exactly so existing user databases keep working without
//! migration.
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

/// Combined schema for all server-owned tables. `IF NOT EXISTS` keeps this
/// idempotent — running it against a database created by the former Bun
/// server is a no-op.
const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS http_cache (
    url TEXT PRIMARY KEY,
    policy TEXT,
    status_code INTEGER NOT NULL,
    content_type TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    body BLOB,
    last_accessed INTEGER NOT NULL,
    last_fetched INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS crates_cache (
    name TEXT PRIMARY KEY,
    body BLOB NOT NULL,
    fetched_at INTEGER NOT NULL
);
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
        for table in ["http_cache", "crates_cache"] {
            let sql = format!("SELECT COUNT(*) FROM {table}");
            match conn.query_row(&sql, [], |row| row.get::<_, i64>(0)) {
                Ok(count) => log::info!("  {table}: {count} entries"),
                Err(err) => log::warn!("  {table}: count failed ({err})"),
            }
        }
    }
}
