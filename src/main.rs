mod prelude {
    pub type WebRequestBuilder = http::request::Builder;
    pub type WebRequest = http::Request<Vec<u8>>;
    pub type WebResponse = http::Response<Vec<u8>>;
}

mod app;
mod webview;

fn main() {
    pretty_env_logger::init();
    app::run()
        .expect("an error occurred while running app");
}

mod consts {
    use std::borrow::Cow;
    use std::env;

    use crate::collections::PrefixCollection;

    /// Returns the server URL derived from the `TURBODOC_PORT` environment variable.
    ///
    /// Panics if the variable is not set -- the launcher is responsible for providing it.
    pub fn server_url() -> String {
        let port = env::var("TURBODOC_PORT")
            .expect("TURBODOC_PORT environment variable is required");
        format!("http://localhost:{port}/")
    }

    /// URL prefixes for documentation domains that the host proxies and tracks.
    pub const KNOWN_URL: PrefixCollection<'static> =
        PrefixCollection(Cow::Borrowed(&[
            "https://docs.rs",
            "https://doc.rust-lang.org",
            "https://microsoft.github.io/windows-docs-rs/doc/",
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
