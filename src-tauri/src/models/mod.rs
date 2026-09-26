//! Data types shared between the monitor, the control layer and the
//! frontend. Everything here is plain data with `camelCase` JSON, mirrored
//! by hand in `src/types/models.ts`.

mod network;
mod process;
mod service;
mod system;

pub use network::*;
pub use process::*;
pub use service::*;
pub use system::*;
