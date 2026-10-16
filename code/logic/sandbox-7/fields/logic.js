// Fields: what levelling a field up costs once (CAPEX) and what keeping it costs each night (OPEX), in HEARTS, both
// paid to the Maia City Coop. Each crop has its own, in the card's values (capex2_<crop>, capex3_<crop>, opex1-3_<crop>)
export function capex({ good, level, valley }) {
  return valley.values['capex' + level + '_' + good] ?? 0;
}
export function opex({ good, level, valley }) {
  return valley.values['opex' + level + '_' + good] ?? 0;
}
