use std::time::Duration;

pub const CACHE_EXPIRY: Duration = Duration::from_secs(60 * 60 * 24); // 1 day
pub const FRONTEND_URL: &str = "http://localhost:9680/";

pub const KNOWN_URL: &[&str] = &[
    "https://docs.rs",
];
