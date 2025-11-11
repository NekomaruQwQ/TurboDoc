mod common;
mod consts;
mod app;
mod server;
mod webview;
mod ipc;

fn main() {
    pretty_env_logger::init();
    app::run();
}
