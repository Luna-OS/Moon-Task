//! Open TCP/UDP sockets and the processes holding them.

use crate::models::{Connection, Protocol};
use netstat2::{get_sockets_info, AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo, TcpState};
use std::net::IpAddr;

pub fn list_connections() -> Result<Vec<Connection>, String> {
    let sockets = get_sockets_info(
        AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6,
        ProtocolFlags::TCP | ProtocolFlags::UDP,
    )
    .map_err(|e| format!("could not list network connections: {e}"))?;

    Ok(sockets
        .into_iter()
        .map(|s| {
            let mut pids = s.associated_pids;
            pids.sort_unstable();
            pids.dedup();
            match s.protocol_socket_info {
                ProtocolSocketInfo::Tcp(tcp) => {
                    let remote = remote(tcp.state, tcp.remote_addr, tcp.remote_port);
                    Connection {
                        protocol: if tcp.local_addr.is_ipv4() {
                            Protocol::Tcp
                        } else {
                            Protocol::Tcp6
                        },
                        local_address: tcp.local_addr.to_string(),
                        local_port: tcp.local_port,
                        remote_port: remote.as_ref().map(|(_, p)| *p),
                        remote_address: remote.map(|(a, _)| a),
                        state: Some(state_label(tcp.state)),
                        pids,
                    }
                }
                ProtocolSocketInfo::Udp(udp) => Connection {
                    protocol: if udp.local_addr.is_ipv4() {
                        Protocol::Udp
                    } else {
                        Protocol::Udp6
                    },
                    local_address: udp.local_addr.to_string(),
                    local_port: udp.local_port,
                    remote_address: None,
                    remote_port: None,
                    state: None,
                    pids,
                },
            }
        })
        .collect())
}

/// A listening socket's "remote" side is just the wildcard address — not
/// worth a column entry.
fn remote(state: TcpState, addr: IpAddr, port: u16) -> Option<(String, u16)> {
    if state == TcpState::Listen || (addr.is_unspecified() && port == 0) {
        None
    } else {
        Some((addr.to_string(), port))
    }
}

pub(crate) fn state_label(state: TcpState) -> &'static str {
    match state {
        TcpState::Listen => "listen",
        TcpState::SynSent => "synSent",
        TcpState::SynReceived => "synReceived",
        TcpState::Established => "established",
        TcpState::FinWait1 | TcpState::FinWait2 => "finWait",
        TcpState::CloseWait => "closeWait",
        TcpState::Closing => "closing",
        TcpState::LastAck => "lastAck",
        TcpState::TimeWait => "timeWait",
        TcpState::Closed | TcpState::DeleteTcb => "closed",
        TcpState::Unknown => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr, TcpListener};

    #[test]
    fn listening_sockets_have_no_remote_side() {
        let any = IpAddr::V4(Ipv4Addr::UNSPECIFIED);
        assert_eq!(remote(TcpState::Listen, any, 0), None);
        assert_eq!(remote(TcpState::Established, any, 0), None);
        let peer = IpAddr::V6(Ipv6Addr::LOCALHOST);
        assert_eq!(
            remote(TcpState::Established, peer, 443),
            Some(("::1".to_string(), 443))
        );
    }

    #[test]
    fn labels_are_stable_camel_case() {
        assert_eq!(state_label(TcpState::Established), "established");
        assert_eq!(state_label(TcpState::FinWait2), "finWait");
        assert_eq!(state_label(TcpState::DeleteTcb), "closed");
    }

    #[test]
    fn finds_our_own_listening_socket() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let connections = list_connections().unwrap();
        let ours = connections
            .iter()
            .find(|c| c.local_port == port && c.protocol == Protocol::Tcp)
            .expect("listener is listed");
        assert_eq!(ours.state, Some("listen"));
        assert_eq!(ours.remote_address, None);
        assert!(ours.pids.contains(&std::process::id()));
    }
}
