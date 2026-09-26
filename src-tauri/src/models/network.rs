use serde::Serialize;

/// One open socket, with the processes that hold it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub protocol: Protocol,
    pub local_address: String,
    pub local_port: u16,
    /// `None` for UDP and for listening TCP sockets.
    pub remote_address: Option<String>,
    pub remote_port: Option<u16>,
    /// The TCP state (`established`, `listen`, …); `None` for UDP.
    pub state: Option<&'static str>,
    pub pids: Vec<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Protocol {
    Tcp,
    Tcp6,
    Udp,
    Udp6,
}
