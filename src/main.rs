mod prelude {
    pub use serde_json::Value as JsonValue;

    pub type WebRequestBuilder = http::request::Builder;
    pub type WebRequest = http::Request<Vec<u8>>;
    pub type WebResponse = http::Response<Vec<u8>>;
}

mod app;
mod server;
mod webview;

fn main() {
    pretty_env_logger::init();
    app::run()
        .expect("an error occurred while running app");
}

mod consts {
    use std::borrow::Cow;
    use std::path::PathBuf;
    use std::sync::LazyLock;
    use std::time::Duration;

    use crate::collections::PrefixCollection;

    pub static DATA_DIR: LazyLock<PathBuf> =
        LazyLock::new(|| nkcore::executable_dir().unwrap().join("data"));
    pub static CACHE_DIR: LazyLock<PathBuf> =
        LazyLock::new(|| nkcore::executable_dir().unwrap().join("cache"));

    pub const CACHE_EXPIRY: Duration = Duration::from_hours(24);

    pub const FRONTEND_URL: &str = "http://localhost:9680/";

    pub const KNOWN_URL: PrefixCollection<'static> =
        PrefixCollection(Cow::Borrowed(&[
            "https://docs.rs",
            "https://doc.rust-lang.org",
            "https://microsoft.github.io/windows-docs-rs/doc/",
        ]));

    pub const IGNORED_URL: PrefixCollection<'static> =
        PrefixCollection(Cow::Borrowed(&[
            "https://docs.rs/-/",
        ]));
}

mod collections {
    use std::borrow::Cow;

    pub struct PrefixCollection<'a>(pub Cow<'a, [&'a str]>);
    impl PrefixCollection<'_> {
        pub fn contains(&self, url: &str) -> bool {
            self.0.iter().any(|&prefix| url.starts_with(prefix))
        }
    }
}
