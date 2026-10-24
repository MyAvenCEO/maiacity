# Unplugged drive mount-path resurrection

Release-base follow-up to `2bb0db19`, isolated from the running native build.

The device CI failure `eves_drive_is_a_device_of_her_vault_hosted_by_the_mac_it_is_plugged_into` was a production filesystem bug. After the test renamed a mounted volume away, a pending save's `Folder::placed` called `create_dir_all` for an object parent. That recreated the missing volume, store and generation ancestors. Staging then failed because the recreated generation had no `new/` directory. Drive enumeration consequently reported a phantom free Photo drive. Waiting longer or removing the assertion would hide the fault.

A disk shelf now retains the original generation directory descriptor. Ordinary object-parent creation first verifies that the mounted generation path still names that inode/device and is not a symlink. It then creates only descendants using descriptor-relative `mkdirat` and opens each component with `O_DIRECTORY | O_NOFOLLOW`. Missing generations and symlink/different-generation replacements fail closed; an ordinary save cannot bootstrap a replacement store. Existing nested object creation still works and directory additions are synced to their parent. The already-locked native libc dependency supplies portable macOS/Linux constants/syscalls; WASM is unchanged.

This narrowly hardens directory creation. Remaining path-based file reads, links and renames have not been converted into a fully descriptor-relative disk backend; no global filesystem-race guarantee is claimed. Generation descriptors follow existing shelf lifetimes, and graceful shutdown/ownership guards remain unchanged.

Lean `MountedGeneration.lean` passes. Added direct regressions cover a late object save after unplug, no fabricated mount point, preserved original content, normal nested creation after replug, symlink parents and replaced generations. Rust tests are pending the coordinator's shared compiler queue; no Cargo build ran in this isolated lane. Required validation: both new `object_parent_creation_` disk tests and the original Eve drive test, retaining its no-volume and file-descriptor-release assertions.

Release integration: [2b4c952c](https://github.com/MyAvenCEO/maiacity/commit/2b4c952c). The separate clean-close/corrupt-all-generations regression in [2a743608](https://github.com/MyAvenCEO/maiacity/commit/2a743608) passed locally (1/1, 7.63 seconds). Direct mounted-generation and physical drive lifecycle validation remain pending.
