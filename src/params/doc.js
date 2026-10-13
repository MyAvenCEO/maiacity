// An iroh doc id as it reads in an address: 32 bytes in lower-case base32 without padding, 52 letters. Only such a
// segment at the root is a Maia Universe post (/<doc>/?t=<title>); every other root address keeps its own page.
export const match = (param) => /^[a-z2-7]{52}$/.test(param);
