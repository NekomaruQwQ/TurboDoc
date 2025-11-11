use serde::{Serialize, Deserialize};
use typeshare::typeshare;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
#[derive(Serialize, Deserialize)]
#[typeshare]
#[non_exhaustive]
#[serde(tag = "type", content = "data")]
pub enum IpcToHost {
    None(i32),
    GetWorkspaceString,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
#[derive(Serialize, Deserialize)]
#[typeshare]
#[non_exhaustive]
#[serde(tag = "type", content = "data")]
pub enum IpcToFrontend {
    None(i32),
}
