// Division and remainder truncate toward zero; the remainder takes the dividend's sign.
function main() {
  print(7 / 2, -7 / 2, 7 % 3, -7 % 3, 7 % -3)  // expect: 3 -3 1 -1 1
}
