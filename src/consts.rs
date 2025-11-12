use std::borrow::Cow;
use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::Duration;

use crate::common::*;

pub static DATA_DIR: LazyLock<PathBuf> =
    LazyLock::new(|| EXECUTABLE_DIR.join("data"));
pub static CACHE_DIR: LazyLock<PathBuf> =
    LazyLock::new(|| EXECUTABLE_DIR.join("cache"));

pub const CACHE_EXPIRY: Duration = Duration::from_secs(60 * 60 * 24); // 1 day

pub const FRONTEND_URL: &str = "http://localhost:9680/";
pub const KNOWN_URL: PrefixCollection<'static> = PrefixCollection(Cow::Borrowed(&[
    "https://docs.rs",
]));

pub struct PrefixCollection<'a>(pub Cow<'a, [&'a str]>);
impl PrefixCollection<'_> {
    pub fn contains(&self, url: &str) -> bool {
        self.0.iter().any(|&prefix| url.starts_with(prefix))
    }
}
