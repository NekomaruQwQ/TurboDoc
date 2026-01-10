pub use ::anyhow;
pub use ::anyhow::Context as _;

pub use pretty_name;
pub use pretty_name::type_name;
pub use pretty_name::type_name_of_val;

pub mod __macro_export {
    pub use nkcore_macros::api_name_of_internal;
    pub use crate::error::ErrorContext;
}

mod error;

pub fn default<T: Default>() -> T { T::default() }

pub fn out_var<T: Default, F: FnOnce(&mut T)>(f: F) -> T {
    let mut out: T = Default::default();
    f(&mut out);
    out
}

pub fn out_var_or_err<T: Default, E, F: FnOnce(&mut T) -> Result<(), E>>(f: F) -> Result<T, E> {
    let mut out: T = Default::default();
    f(&mut out)?;
    Ok(out)
}

pub mod env {
    use std::env;
    use std::path::PathBuf;

    pub fn executable_dir() -> &'static PathBuf {
        crate::cache!(|| -> PathBuf {
            executable_dir_internal()
                .expect("failed to get executable path")
        })
    }

    fn executable_dir_internal() -> anyhow::Result<PathBuf> {
        let executable_path = env::current_exe()?;
        let executable_dir = executable_path
            .parent()
            .ok_or_else(|| anyhow::anyhow!("failed to get parent directory of {}", executable_path.display()))?;
        Ok(executable_dir.to_owned())
    }
}

/// Helper macro for caching calculation results in thread-local storage.
///
/// This macro accepts an `FnOnce() -> T` closure, caches it using a thread-local
/// [`OnceCell`] and returns a `'static` reference to the cached value.
/// Each unique macro invocation has its own cache entry.
///
/// [`OnceCell`]: std::cell::OnceCell
#[macro_export] macro_rules! cache {
    (|| -> $ty:ty $init:block) => {{
        ::std::thread_local!(
            static CACHE:
                ::std::cell::OnceCell<&'static $ty> =
                ::std::cell::OnceCell::new());
        CACHE.with(|once| *once.get_or_init(|| Box::leak(Box::new($init))))
    }};
}
