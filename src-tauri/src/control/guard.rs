//! Risk classification for process actions. The frontend mirrors these
//! rules (`src/lib/risk.ts`) to decide when to show a confirmation dialog,
//! but this is the copy that counts.

use super::ProcessAction;
use crate::models::Owner;
use crate::monitor::Target;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Risk {
    /// The user's own process: go ahead.
    Low,
    /// Someone else's process, or a whole tree: only with confirmation.
    High,
    /// Never, with the reason shown to the user.
    Forbidden(String),
}

pub fn assess(action: &ProcessAction, target: &Target) -> Risk {
    if target.protected && *action != ProcessAction::Resume {
        return Risk::Forbidden(format!(
            "{} is protected — ending, suspending or re-prioritizing it would crash the system or MoonTask itself",
            target.name
        ));
    }
    match action {
        // Resuming only ever un-freezes something; priority changes are
        // reversible and the OS refuses what the user may not do.
        ProcessAction::Resume | ProcessAction::SetPriority { .. } => Risk::Low,
        // A tree can hold far more than the one process the user sees.
        ProcessAction::KillTree => Risk::High,
        ProcessAction::Terminate | ProcessAction::Kill | ProcessAction::Suspend => {
            if target.owner == Owner::Current {
                Risk::Low
            } else {
                Risk::High
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Priority;

    fn target(owner: Owner, protected: bool) -> Target {
        Target {
            pid: 1234,
            name: "demo".into(),
            owner,
            protected,
            start_time: 1,
        }
    }

    #[test]
    fn own_processes_are_low_risk() {
        let t = target(Owner::Current, false);
        assert_eq!(assess(&ProcessAction::Terminate, &t), Risk::Low);
        assert_eq!(assess(&ProcessAction::Kill, &t), Risk::Low);
        assert_eq!(assess(&ProcessAction::Suspend, &t), Risk::Low);
    }

    #[test]
    fn other_owners_need_confirmation() {
        for owner in [Owner::System, Owner::Other] {
            let t = target(owner, false);
            assert_eq!(assess(&ProcessAction::Terminate, &t), Risk::High);
            assert_eq!(assess(&ProcessAction::Kill, &t), Risk::High);
            assert_eq!(assess(&ProcessAction::Suspend, &t), Risk::High);
        }
    }

    #[test]
    fn trees_always_need_confirmation() {
        assert_eq!(
            assess(&ProcessAction::KillTree, &target(Owner::Current, false)),
            Risk::High
        );
    }

    #[test]
    fn protected_processes_can_only_be_resumed() {
        let t = target(Owner::System, true);
        for action in [
            ProcessAction::Terminate,
            ProcessAction::Kill,
            ProcessAction::KillTree,
            ProcessAction::Suspend,
            ProcessAction::SetPriority {
                priority: Priority::Idle,
            },
        ] {
            assert!(
                matches!(assess(&action, &t), Risk::Forbidden(_)),
                "{action:?}"
            );
        }
        assert_eq!(assess(&ProcessAction::Resume, &t), Risk::Low);
    }

    #[test]
    fn priority_changes_are_low_risk() {
        let action = ProcessAction::SetPriority {
            priority: Priority::High,
        };
        assert_eq!(assess(&action, &target(Owner::System, false)), Risk::Low);
    }
}
