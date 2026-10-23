//! Optional packet carriers beneath the same authenticated post-quantum iroh connection.
//! Routes come from the peer capability exchange; adding an outer route grants no data authority.
pub(crate) mod control;
mod framing;
mod packet;
pub use packet::{Carrier, Command, PacketTransport, RouteId};

#[cfg(not(target_arch = "wasm32"))]
mod webtransport;
#[cfg(not(target_arch = "wasm32"))]
pub use webtransport::{NativeWt, Config as WtConfig, Reservation as WtReservation, WtEvent};
