//! Padmé (PURBs; `Aven.ID.Padme`): the one padding avenDB uses, for segments' bytes and epochs' stanza lists (D18).
//! A length grows by at most an eighth (`padme_le`), and lengths below nine stay as they are.

/// The padded length of `l`.
pub fn padme(l: usize) -> usize {
    if l < 2 {
        return l;
    }
    let e = usize::BITS - 1 - l.leading_zeros(); // ⌊log₂ l⌋
    let s = u32::BITS - e.leading_zeros(); // ⌊log₂ e⌋ + 1
    let unit = 1usize << e.saturating_sub(s);
    l.div_ceil(unit) * unit
}

/// The fewest stanzas an epoch has (`Aven.ID.KeyFormats.minStanzas`), so a lone reader doesn't show.
pub const MIN_STANZAS: usize = 4;

/// How many stanzas an epoch with `readers` readers has (`Aven.ID.KeyFormats.padded`): at least four, then Padmé.
pub fn padded(readers: usize) -> usize {
    padme(readers.max(MIN_STANZAS))
}
