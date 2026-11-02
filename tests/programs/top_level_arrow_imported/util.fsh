const base = 100;
export const scale = (x: i64) => x * base;
export const greet = async (name: string): Promise<string> => `hi ${name}`;
export const count = <T>(xs: T[]): i64 => xs.length as i64;
