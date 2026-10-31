// The only file naming btoa, toHex and u8.fromHex; main names none of them.
export function encode(s: string): string throws TypeError {
  return btoa(s) + " " + new TextEncoder().encode(s).toHex();
}
export function decode(hex: string): u8[] throws TypeError {
  return u8.fromHex(hex);
}
