// case: mcu_registers
import { registers } from "std:mcu";
@registers(0x40004000)
class Uart {
  data: u32;
  flags: u8;
  ctrl: u32;
  wide: u64;
}
function main() {
  unsafe {
    console.log(Uart.data() as usize, Uart.flags() as usize, Uart.ctrl() as usize, Uart.wide() as usize);
  }
}
// expect: 1073758208 1073758212 1073758216 1073758224
// case: mcu_register_not_integer
import { registers } from "std:mcu";
@registers(0x40004000)
class Bad {
  level: f32;
}
function main() {}
// error: register 'level' is an integer of 8, 16, 32 or 64 bits, not 'f32'
// case: mcu_registers_on_a_function
import { registers } from "std:mcu";
@registers(0) function f() {}
function main() {}
// error: '@registers' applies to a class whose fields are a peripheral's registers, in order
