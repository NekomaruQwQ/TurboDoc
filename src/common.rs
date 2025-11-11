use std::env;
use std::path::PathBuf;
use std::sync::LazyLock;

pub type WebRequest = http::Request<Vec<u8>>;
pub type WebResponse = http::Response<Vec<u8>>;
pub use http::request::Builder as WebRequestBuilder;
pub use http::response::Builder as WebResponseBuilder;

pub fn default<T: Default>() -> T { T::default() }

pub static EXECUTABLE_DIR: LazyLock<PathBuf> = LazyLock::new(|| {
    env::current_exe()
        .unwrap_or_else(|err| panic!("failed to get executable path: {err}"))
        .parent()
        .expect("failed to get executable path: missing parent directory")
        .to_owned()
});
