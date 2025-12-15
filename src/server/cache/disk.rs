use nkcore::*;
use anyhow::anyhow;

use std::borrow::Cow;
use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use std::path::PathBuf;

use super::WebResource;
use super::generic::CacheProvider;

pub struct DiskCache {
    base_dir: PathBuf,
}

impl CacheProvider<str, WebResource> for DiskCache {
    fn get(&self, url: &str) -> Option<Cow<'_, WebResource>> {
        self.try_get(url)
            .with_context(|| context!("an error occurred while querying cache file for `{url}`"))
            .inspect_err(|err| log::error!("{err}"))
            .unwrap_or_default()
    }

    fn insert(&mut self, url: &str, entry: Cow<WebResource>) {
        self.try_insert(url, entry.as_ref())
            .with_context(|| context!("an error occurred while creating cache file for `{url}`"))
            .unwrap_or_else(|err| log::error!("{err}"));
    }

    fn remove(&mut self, url: &str) {
        self.try_remove(url)
            .with_context(|| context!("an error occurred while removing cache file for `{url}`"))
            .unwrap_or_else(|err| log::error!("{err}"));
    }
}

impl DiskCache {
    pub fn new<P: AsRef<Path>>(base_dir: P) -> Self {
        let base_path = base_dir.as_ref().to_owned();
        fs::create_dir_all(&base_path)
            .with_context(|| context!("failed to create cache directory `{}`", base_path.display()))
            .unwrap_or_else(|err| log::error!("{err}"));
        Self { base_dir: base_path }
    }

    fn data_path(&self, url: &str) -> PathBuf {
        self.base_dir.join(escape_url(url))
    }

    fn metadata_path(&self, url: &str) -> PathBuf {
        self.base_dir.join(format!("{}.meta.toml", escape_url(url)))
    }

    fn try_get(&self, url: &str) -> anyhow::Result<Option<Cow<'_, WebResource>>> {
        let metadata_path = self.metadata_path(url);
        let data_path = self.data_path(url);

        let Some(metadata) = read_file(&metadata_path)? else {
            return Ok(None);
        };

        let metadata =
            api_call!(String::from_utf8(metadata))
                .context("failed to parse metadata")?;
        let metadata =
            api_call!(toml::from_str::<WebResource>(&metadata))
                .context("failed to parse metadata")?;
        if metadata.url != url {
            log::warn!("ignoring disk cache for `{url}` due to key mismatch");
            return Ok(None);
        }

        Ok(Some(Cow::Owned(match metadata.status_code {
            302 => metadata,
            200 => {
                let content =
                    read_file(&data_path)?
                        .ok_or_else(|| anyhow!("missing cache file at `{}`", data_path.display()))?;
                WebResource { content, ..metadata }
            },
            _ => Err(anyhow!("unexpected `status_code` value `{}` in metadata file", metadata_path.display()))?,
        })))
    }

    fn try_insert(&self, url: &str, entry: &WebResource) -> anyhow::Result<()> {
        let metadata =
            toml::to_string_pretty(&entry)
                .context("failed to serialize metadata")?;
        write_file(&self.metadata_path(url), metadata.as_bytes())?;
        if entry.status_code == 200 {
            write_file(&self.data_path(url), &entry.content)?;
        }
        Ok(())
    }

    fn try_remove(&self, url: &str) -> anyhow::Result<()> {
        remove_file(&self.metadata_path(url))?;
        remove_file(&self.data_path(url))?;
        Ok(())
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
            Err(err).with_context(|| context!("failed to read file `{}`", path.display())),
    }
}

fn write_file(path: &PathBuf, data: &[u8]) -> anyhow::Result<()> {
    log::debug!(" -> writing file `{}`", path.display());
    let parent =
        path.parent()
            .expect("path must have a parent directory");
    api_call!(fs::create_dir_all(parent))
        .with_context(|| context!("failed to create directory `{}`", parent.display()))?;
    api_call!(fs::write(path, data))
        .with_context(|| context!("failed to write file `{}`", path.display()))?;
    Ok(())
}

fn remove_file(path: &PathBuf) -> anyhow::Result<()> {
    log::debug!(" -> removing file `{}`", path.display());
    match fs::remove_file(path) {
        Ok(()) =>
            Ok(()),
        Err(err) if err.kind() == ErrorKind::NotFound =>
            Ok(()),
        Err(err) =>
            Err(err).context(context!("failed to remove file `{}`", path.display())),
    }
}
