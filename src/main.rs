mod prelude {
    pub type WebRequest = http::Request<Vec<u8>>;
    pub type WebResponse = http::Response<Vec<u8>>;
    pub use http::request::Builder as WebRequestBuilder;
    pub use http::response::Builder as WebResponseBuilder;
}

mod app;
mod server;
mod webview;

fn main() {
    pretty_env_logger::init();
    app::run();
}

mod consts {
    use std::borrow::Cow;
    use std::path::PathBuf;
    use std::sync::LazyLock;
    use std::time::Duration;

    use crate::collections::PrefixCollection;

    pub static DATA_DIR: LazyLock<PathBuf> =
        LazyLock::new(|| nkcore::executable_dir().join("data"));
    pub static CACHE_DIR: LazyLock<PathBuf> =
        LazyLock::new(|| nkcore::executable_dir().join("cache"));

    pub const CACHE_EXPIRY: Duration = Duration::from_secs(60 * 60 * 24); // 1 day

    pub const FRONTEND_URL: &str = "http://localhost:9680/";
    pub const KNOWN_URL: PrefixCollection<'static> = PrefixCollection(Cow::Borrowed(&[
        "https://docs.rs",
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
