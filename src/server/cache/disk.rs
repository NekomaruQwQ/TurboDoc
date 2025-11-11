use std::borrow::Cow;
use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use std::path::PathBuf;

use anyhow::anyhow;
use anyhow::Context as _;

use super::WebResource;
use super::generic::CacheProvider;

pub struct DiskCache {
    base_dir: PathBuf,
}

impl DiskCache {
    pub fn new<P: AsRef<Path>>(base_dir: P) -> Self {
        let base_path = base_dir.as_ref().to_owned();
        fs::create_dir_all(&base_path)
            .with_context(|| format!("failed to create directory `{}`", base_path.display()))
            .unwrap();
        Self { base_dir: base_path }
    }

    fn data_path(&self, url: &str) -> PathBuf {
        self.base_dir.join(escape_url(url))
    }

    fn metadata_path(&self, url: &str) -> PathBuf {
        self.base_dir.join(format!("{}.meta.toml", escape_url(url)))
    }
}

impl CacheProvider<str, WebResource> for DiskCache {
    fn get(&self, url: &str) -> Option<Cow<'_, WebResource>> {
        let result = || -> anyhow::Result<Option<WebResource>> {
            let metadata_path = self.metadata_path(url);
            let data_path = self.data_path(url);

            let Some(metadata) = read_file(&metadata_path)? else {
                return Ok(None);
            };

            let metadata =
                String::from_utf8(metadata)
                    .context("failed to parse metadata")?;
            let metadata =
                toml::from_str::<WebResource>(&metadata)
                    .context("failed to parse metadata")?;
            if metadata.url != url {
                log::warn!("ignoring disk cache for `{url}` due to key mismatch");
                return Ok(None);
            }

            Ok(Some(match metadata.status_code {
                302 => metadata,
                200 => {
                    let content =
                        read_file(&data_path)?
                            .ok_or_else(|| anyhow!("missing cache file at `{}`", data_path.display()))?;
                    WebResource { content, ..metadata }
                },
                _ => Err(anyhow!("unexpected `status_code` value `{}` in metadata file", metadata_path.display()))?,
            }))
        }();

        result
            .inspect_err(|err| log::error!("{err}"))
            .ok()
            .flatten()
            .map(Cow::Owned)
    }

    fn insert(&mut self, url: &str, entry: Cow<WebResource>) {
        let result = || -> anyhow::Result<()> {
            let metadata =
                toml::to_string_pretty(&entry)
                    .context("failed to serialize metadata")?;
            write_file(&self.metadata_path(url), metadata.as_bytes())?;
            if entry.status_code == 200 {
                write_file(&self.data_path(url), &entry.content)?;
            }
            Ok(())
        }();

        if let Err(err) = result {
            log::error!("{err}");
        }
    }

    fn remove(&mut self, url: &str) {
        let result = || -> anyhow::Result<()> {
            remove_file(&self.metadata_path(url))?;
            remove_file(&self.data_path(url))?;
            Ok(())
        }();

        if let Err(err) = result {
            log::error!("{err}");
        }
    }
}

fn escape_url(url: &str) -> String {
    let str =
        url
            .strip_prefix("https://")
            .expect("unexpected protocol in url");
    let str = if str.ends_with('/') {
        Cow::Owned(format!("{}index.html", &str))
    } else {
        Cow::Borrowed(str)
    };

    str.replace(|c: char| !{
        c == '/' ||
        c == '.' ||
        c == '-' ||
        c == '_' ||
        c.is_ascii_alphanumeric()
    }, "+")
}

fn read_file(path: &PathBuf) -> anyhow::Result<Option<Vec<u8>>> {
    log::debug!(" -> reading file `{}`", path.display());
    match fs::read(path) {
        Ok(data) =>
            Ok(Some(data)),
        Err(err) if err.kind() == ErrorKind::NotFound =>
            Ok(None),
        Err(err) =>
            Err(err).context(format!("failed to read file `{}`", path.display())),
    }
}

fn write_file(path: &PathBuf, data: &[u8]) -> anyhow::Result<()> {
    log::debug!(" -> writing file `{}`", path.display());
    let parent =
        path.parent()
            .expect("path must have a parent directory");
    fs::create_dir_all(parent)
        .with_context(|| format!("failed to create directory `{}`", parent.display()))?;
    fs::write(path, data)
        .with_context(|| format!("failed to write file `{}`", path.display()))?;
    anyhow::Ok(())
}

fn remove_file(path: &PathBuf) -> anyhow::Result<()> {
    log::debug!(" -> removing file `{}`", path.display());
    match fs::remove_file(path) {
        Ok(()) =>
            Ok(()),
        Err(err) if err.kind() == ErrorKind::NotFound =>
            Ok(()),
        Err(err) =>
            Err(err).context(format!("failed to remove file `{}`", path.display())),
    }
}
