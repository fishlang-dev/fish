use std::sync::atomic::{AtomicI64, Ordering};

static BUMPS: AtomicI64 = AtomicI64::new(0);

pub fn add(a: i64, b: i64) -> i64 {
    a + b
}

pub fn half(x: f64) -> f64 {
    x / 2.0
}

pub fn shrink(x: f32) -> f32 {
    x * 0.5
}

pub fn even(n: u8) -> bool {
    n % 2 == 0
}

pub fn wrap(n: i8) -> i8 {
    n.wrapping_add(1)
}

pub fn widths(a: u16, b: i16, c: u32, d: u64, e: isize) -> usize {
    a as usize + b as usize + c as usize + d as usize + e as usize
}

pub fn bump() {
    BUMPS.fetch_add(1, Ordering::SeqCst);
}

pub fn bumps() -> i64 {
    BUMPS.load(Ordering::SeqCst)
}

pub fn check(n: i64) -> i64 {
    if n < 0 {
        panic!("negative: {n}");
    }
    n
}

pub mod util {
    pub fn mul(a: i32, b: i32) -> i32 {
        a * b
    }
}

pub fn nul() -> i64 {
    panic!("before\0after")
}

struct Bomb;

impl Drop for Bomb {
    fn drop(&mut self) {
        panic!("dropped");
    }
}

pub fn bomb() -> i64 {
    std::panic::panic_any(Bomb)
}
