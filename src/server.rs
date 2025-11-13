#![expect(clippy::panic_in_result_fn)]
#![expect(clippy::map_err_ignore)]

use std::borrow::Cow;
use std::path::Path;
use std::time::Duration;
use std::time::SystemTime;

use anyhow::anyhow;
use anyhow::Context as _;

use serde::Deserialize;
use serde::Serialize;

use http::header;
use http::{
    HeaderMap,
    HeaderName,
    HeaderValue,
    Method,
    StatusCode,
};

use reqwest::blocking::Client as HttpClient;
use http::response::Builder as ResponseBuilder;

use crate::prelude::*;
use crate::consts::*;

mod cache {
    #![expect(clippy::renamed_function_params)]

    mod disk;
    mod generic;

    pub use generic::CacheProvider;
    pub use disk::DiskCache;
    pub type MemoryCache = generic::MemoryCache<str, WebResource>;

    use super::WebResource;
}

use cache::CacheProvider as _;
use cache::DiskCache;
use cache::MemoryCache;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
#[derive(Serialize, Deserialize)]
pub struct WebResource {
    /// The URL of the cached resource. Must match the key used to store and retrieve the entry.
    /// In disk cache, this is used to verify the validity of the cache file.
    pub url: String,

    /// The time when the resource was last fetched. Used for cache expiration.
    pub last_fetched: SystemTime,

    /// The HTTP status code of the response. Currently only 200 (OK) and 302 (Found) are supported.
    pub status_code: u16,

    /// The location URL for redirects. Only used if `status_code` is 302. Empty string otherwise.
    pub location: String,

    /// The MIME type of the response. Only used if `status_code` is 200. Empty string otherwise.
    pub content_type: String,

    /// The response body of the resource. Only used if `status_code` is 200.
    ///
    /// The content is stored in separate file and not together with the metadata, so we skip it
    /// during metadata serialization.
    #[serde(skip)]
    pub content: Vec<u8>,
}

pub struct WebServer {
    http_client: HttpClient,
    disk_cache: DiskCache,
    memory_cache: MemoryCache,
}

impl WebServer {
    pub fn new<P: AsRef<Path>>(cache_dir: P) -> Self {
        Self {
            http_client: HttpClient::new(),
            disk_cache: DiskCache::new(cache_dir),
            memory_cache: MemoryCache::new(),
        }
    }

    pub fn handle_request(&mut self, request: WebRequest) -> WebResponse {
        let request_url = request.uri().to_string();
        let request_method = request.method().clone();

        assert!(KNOWN_URL.contains(&request_url));
        assert_eq!(request.method(), Method::GET);

        log::info!("{request_method} {request_url}");

        match self.get_or_fetch_resource(&request_url, &request) {
            Ok(Ok(resource)) => {
                let elapsed_since_last_fetched =
                    SystemTime::now()
                        .duration_since(resource.last_fetched)
                        .unwrap_or(Duration::MAX);
                if elapsed_since_last_fetched > CACHE_EXPIRY {
                    log::info!(" -> cache expired");

                    let request_url = request.uri().to_string();
                    self.disk_cache.remove(&request_url);
                    self.memory_cache.remove(&request_url);

                    // Refetch the resource by handling the request again.
                    return self.handle_request(request);
                }

                if resource.status_code == 302 {
                    log::info!(" -> redirecting to {}", resource.location);
                }

                create_response_from_resource(resource)
            },
            Ok(Err(response)) => {
                let status = response.status();
                log::error!("{} {}", request.method(), request.uri());
                log::error!(" -> {status}");
                create_response_from_status(status)
            },
            Err(err) => {
                log::error!("{} {}", request.method(), request.uri());
                log::error!(" -> {err}");
                create_response_from_status(StatusCode::INTERNAL_SERVER_ERROR)
            }
        }
    }

    fn get_or_fetch_resource(&mut self, request_url: &str, request: &WebRequest)
     -> anyhow::Result<Result<WebResource, reqwest::blocking::Response>> {
        if let Some(resource) = self.memory_cache.get(request_url) {
            return Ok(Ok(resource.into_owned()));
        }

        if let Some(resource) = self.disk_cache.get(request_url) {
            self.memory_cache
                .insert(request_url, resource.clone());
            return Ok(Ok(resource.into_owned()));
        }

        let result = fetch_resource(&self.http_client, request);
        if let Ok(Ok(ref resource)) = result {
            log::info!(" -> fetched");
            self.disk_cache
                .insert(request_url, Cow::Borrowed(resource));
            self.memory_cache
                .insert(request_url, Cow::Borrowed(resource));
        }

        result
    }
}

fn fetch_resource(http_client: &HttpClient, request: &WebRequest)
 -> anyhow::Result<Result<WebResource, reqwest::blocking::Response>> {
    let request_url = request.uri().to_string();
    let response =
        http_client
            .request(request.method().clone(), &request_url)
            .headers(request.headers().clone())
            .send()
            .context("failed to send request")?;
    let response_status =
        response.status();
    let response_url =
        response.url().to_string();
    Ok(match response_status {
        StatusCode::OK => {
            assert_eq!(response_url, request_url);
            let content_type =
                get_header(response.headers(), header::CONTENT_TYPE)
                    .map_err(|err| anyhow!("failed to get header `Content-Type`: {err}"))?;
            let data =
                response
                    .bytes()
                    .context("failed to read response body")?
                    .into();
            Ok(WebResource {
                url: request_url,
                last_fetched: SystemTime::now(),
                status_code: 200,
                location: String::new(),
                content_type,
                content: data,
            })
        },
        StatusCode::FOUND =>
            Ok(WebResource {
                url: request_url,
                last_fetched: SystemTime::now(),
                status_code: response_status.as_u16(),
                location: response_url,
                content_type: String::new(),
                content: Vec::new(),
            }),
        _ =>
            Err(response),
    })
}

fn create_response_from_status(status: StatusCode) -> WebResponse {
    ResponseBuilder::new()
        .status(status)
        .body(Vec::new())
        .unwrap()
}

fn create_response_from_resource(resource: WebResource) -> WebResponse {
    match resource.status_code {
        200 => {
            let resource = rewrite_content(resource);
            let content_type =
                resource.content_type;
            let content_length =
                resource.content.len();
            let mut response = WebResponse::new(resource.content);
            response.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_str(&content_type).unwrap());
            response.headers_mut().insert(
                header::CONTENT_LENGTH,
                HeaderValue::from_str(&content_length.to_string()).unwrap());
            response
        },
        302 => {
            let mut response =
                ResponseBuilder::new()
                    .status(StatusCode::FOUND)
                    .body(Vec::new())
                    .unwrap();
            response.headers_mut().insert(
                header::LOCATION,
                HeaderValue::from_str(&resource.location).unwrap());
            response
        },
        _ => panic!("unexpected value for `WebResource::status_code`: {}", resource.status_code),
    }
}

fn get_header(headers: &HeaderMap, header_name: HeaderName) -> Result<String, &'static str> {
    Ok(headers
        .get(header_name)
        .ok_or("<missing>")?
        .to_str()
        .map_err(|_| "<invalid utf-8>")?
        .to_owned())
}

fn rewrite_content(mut entry: WebResource) -> WebResource {
    // Force dark theme for docs.rs pages.
    if
    entry.status_code == 200 &&
        entry.content_type.starts_with("text/html") &&
        entry.url.starts_with("https://docs.rs/") {
        entry.content =
            String::from_utf8_lossy(&entry.content)
                .replace(
                    r#"<meta charset="UTF-8">"#,
                    concat!(
                    r#"<meta charset="UTF-8">"#,
                    r#"<script>window.localStorage.setItem('rustdoc-theme', 'dark');</script>"#, ))
                .into_bytes();
    }

    entry
}
