//! face-runtime's module: the ABI's two exports over `aven_runtimes_face::eval`. The only `unsafe` is `no_mangle` on
//! the two exports, which name them for the host.

#![deny(unsafe_code)]

#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: u32) -> u32 {
    aven_runtimes_abi::alloc(len)
}

#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn run(part_ptr: u32, part_len: u32, input_ptr: u32, input_len: u32) -> u32 {
    aven_runtimes_abi::run(
        aven_runtimes_face::eval,
        part_ptr,
        part_len,
        input_ptr,
        input_len,
    )
}
