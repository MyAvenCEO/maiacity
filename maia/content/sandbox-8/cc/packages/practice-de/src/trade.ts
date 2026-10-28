/**
 * How suppliers keep their week here (decision 0010: practice, design/modular-split.md §5.3 item 2). Quarries, concrete
 * plants and builders' merchants load lorries Monday to Friday; a counter (a builders' merchant's, a shop's) is open
 * Monday to Saturday where a supplier says no days of its own, and shut on Sundays. On a public holiday neither loads nor
 * sells (the holidays are the law's). The usual week of the trade, not a measured one.
 */
export const supplierWeek = {
  loading: [0, 1, 2, 3, 4],
  counter: [0, 1, 2, 3, 4, 5],
};
