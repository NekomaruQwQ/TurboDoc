mod common;
mod consts;
mod app;
mod server;
mod webview;

fn main() {
    pretty_env_logger::init();
    app::run();
}
