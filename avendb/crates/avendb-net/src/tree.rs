//! The BLAKE3 trees iroh-blobs checks a blob by, as a shelf keeps them (blobs B2d, B3b, `shelf`): a blob's outboard,
//! the hashes of its tree's parents in post-order, made as its bytes stream in (`Outboarder`); and the ranges a request
//! asks of a blob cut to it as iroh-blobs cuts them (`truncate`).

use bao_tree::blake3;
use bao_tree::blake3::hazmat::{ChainingValue, HasherExt as _, Mode, merge_subtrees_non_root, merge_subtrees_root};
use bao_tree::{ChunkNum, ChunkRangesRef};
use iroh_blobs::Hash;

/// The bytes of a block, a leaf of the trees iroh-blobs keeps (`IROH_BLOCK_SIZE`): 16 chunks of a kilobyte.
pub(crate) const BLOCK: usize = 16 << 10;

/// The chaining value of the block of `data` that starts at chunk `start`, a block of a blob of more than one.
pub(crate) fn leaf(start: u64, data: &[u8]) -> ChainingValue {
    let mut hasher = blake3::Hasher::new();
    hasher.set_input_offset(start * 1024);
    hasher.update(data);
    hasher.finalize_non_root()
}

/// The hash of a blob's tree as its bytes come, a block at a time, and its outboard: the pair of hashes of each of its
/// parents, in post-order, as iroh-blobs keeps beside a blob, the root's last. A blob of one block has none.
pub(crate) struct Outboarder {
    /// The chaining values of the subtrees whole so far and not merged yet, the biggest first.
    stack: Vec<ChainingValue>,
    /// How many blocks it hashed.
    blocks: u64,
    /// The bytes of the block it hasn't hashed yet: the last stays until more bytes come, as it may be the root.
    block: Vec<u8>,
    outboard: Vec<u8>,
    size: u64,
}

impl Outboarder {
    pub(crate) fn new() -> Outboarder {
        Outboarder { stack: Vec::new(), blocks: 0, block: Vec::with_capacity(BLOCK), outboard: Vec::new(), size: 0 }
    }

    /// The blob's next bytes.
    pub(crate) fn push(&mut self, mut data: &[u8]) {
        while !data.is_empty() {
            if self.block.len() == BLOCK {
                let cv = leaf(self.blocks * (BLOCK / 1024) as u64, &self.block);
                self.add(cv);
                self.block.clear();
            }
            let n = (BLOCK - self.block.len()).min(data.len());
            self.block.extend_from_slice(&data[..n]);
            (data, self.size) = (&data[n..], self.size + n as u64);
        }
    }

    /// The next block's chaining value, once the subtrees it closes are merged: as many stay as the blocks before it
    /// have ones in binary, as BLAKE3 merges.
    fn add(&mut self, cv: ChainingValue) {
        while self.stack.len() > self.blocks.count_ones() as usize {
            let (right, left) = (self.stack.pop().expect("a subtree"), self.stack.pop().expect("a subtree"));
            let merged = self.merge(left, right);
            self.stack.push(merged);
        }
        self.stack.push(cv);
        self.blocks += 1;
    }

    /// The parent of `left` and `right`, not the root, kept in the outboard.
    fn merge(&mut self, left: ChainingValue, right: ChainingValue) -> ChainingValue {
        self.outboard.extend_from_slice(&left);
        self.outboard.extend_from_slice(&right);
        merge_subtrees_non_root(&left, &right, Mode::Hash)
    }

    /// The blob's hash, its size and its outboard.
    pub(crate) fn finish(mut self) -> (Hash, u64, Vec<u8>) {
        if self.blocks == 0 {
            return (blake3::hash(&self.block).into(), self.size, Vec::new());
        }
        let cv = leaf(self.blocks * (BLOCK / 1024) as u64, &self.block);
        self.add(cv);
        let mut right = self.stack.pop().expect("a block");
        loop {
            let left = self.stack.pop().expect("two blocks at least");
            if self.stack.is_empty() {
                self.outboard.extend_from_slice(&left);
                self.outboard.extend_from_slice(&right);
                let root = merge_subtrees_root(&left, &right, Mode::Hash);
                return (root.into(), self.size, self.outboard);
            }
            right = self.merge(left, right);
        }
    }
}

/// `ranges` of a blob of `size` bytes as iroh-blobs reads them: whatever they ask past its last chunk asks for that
/// chunk, as a request that doesn't know the size asks for the end (`bao_tree`'s own `truncate_ranges`).
pub(crate) fn truncate(ranges: &ChunkRangesRef, size: u64) -> &ChunkRangesRef {
    let end = ChunkNum::chunks(size);
    let last = ChunkNum(end.0.saturating_sub(1));
    let bs = ranges.boundaries();
    let n = match bs.binary_search(&last) {
        Ok(i) if i & 1 == 0 => i + 1,
        Ok(i) if bs.len() == i + 1 => i + 1,
        Ok(i) => i,
        Err(i) if i & 1 == 0 && bs.len() == i => i,
        Err(i) if i & 1 == 0 => i + 1,
        Err(i) => i,
    };
    ChunkRangesRef::new_unchecked(&bs[..n])
}

#[cfg(test)]
mod tests {
    use super::*;
    use bao_tree::io::outboard::PostOrderMemOutboard;
    use iroh_blobs::store::IROH_BLOCK_SIZE;

    #[test]
    fn the_outboard_made_as_bytes_stream_in_is_iroh_blobs_own() {
        let sizes = [0, 1, 1024, BLOCK - 1, BLOCK, BLOCK + 1, 2 * BLOCK, 3 * BLOCK + 7, 7 * BLOCK, 8 * BLOCK, 1 << 20];
        for size in sizes.into_iter().chain([(1 << 20) + 12_345, 5 * (1 << 20) / 3]) {
            let data: Vec<u8> = (0..size).map(|i| (i * 31 % 251) as u8).collect();
            let theirs = PostOrderMemOutboard::create(&data, IROH_BLOCK_SIZE);
            // fed in odd steps, across the blocks' edges
            let mut ours = Outboarder::new();
            data.chunks(7_777).for_each(|c| ours.push(c));
            let (hash, len, outboard) = ours.finish();
            assert_eq!(hash, Hash::from(theirs.root), "the root of {size} bytes");
            assert_eq!((len, outboard), (size as u64, theirs.data), "and the outboard");
        }
    }
}
