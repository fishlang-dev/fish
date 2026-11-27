// Many-armed string switch and match statements are entered by a hash of the subject; they behave
// as tests in order do.
// case: string_switch_hashed
// expect: one 1
// expect: two 2 three 3
// expect: three 3
// expect: other
// expect: four 4 other
// expect: empty
// expect: café
// expect: emoji
// expect: nine
// expect: other
// expect: other
function name(s: string): string {
  let out = "";
  switch (s) {
    case "one":
      out += "one 1";
      break;
    case "two":
      out += "two 2 ";
    case "three":
      out += "three 3";
      break;
    case "four":
      out += "four 4 ";
    default:
      out += "other";
      break;
    case "":
      out += "empty";
      break;
    case "café":
      out += "café";
      break;
    case "😀":
      out += "emoji";
      break;
    case "one":
      out += "never";
      break;
    case "nine":
      out += "nine";
      break;
  }
  return out;
}
function main() {
  for (const s of ["one", "two", "three", "five", "four", "", "café", "😀", "nine", "nin", "cafe"]) console.log(name(s));
}
// case: string_switch_no_default
// expect: a
// expect: h
// expect: -
// expect: j
function letter(s: string): string {
  switch (s) {
    case "alpha": return "a";
    case "bravo": return "b";
    case "charlie": return "c";
    case "delta": return "d";
    case "echo": return "e";
    case "foxtrot": return "f";
    case "golf": return "g";
    case "hotel": return "h";
    case "juliett": return "j";
  }
  return "-";
}
function main() {
  console.log(letter("alpha"));
  console.log(letter("hotel"));
  console.log(letter("india"));
  console.log(letter("jul" + "iett"));
}
// case: string_match_hashed
// expect: red guarded
// expect: red
// expect: warm
// expect: warm
// expect: cool
// expect: grey
// expect: other: mauve
// expect: other: Red
function kind(s: string, strict: boolean): string {
  return match (s) {
    case "red" if strict => "red guarded",
    case "red" => "red",
    case "orange" | "yellow" => "warm",
    case "green" => "green",
    case "blue" | "indigo" | "violet" => "cool",
    case "black" => "black",
    case "white" => "white",
    case "grey" | "gray" => "grey",
    case other => "other: " + other,
  };
}
function main() {
  console.log(kind("red", true));
  console.log(kind("red", false));
  console.log(kind("orange", false));
  console.log(kind("yel" + "low", false));
  console.log(kind("violet", true));
  console.log(kind("gray", true));
  console.log(kind("mauve", true));
  console.log(kind("Red", true));
}
// case: string_dispatch_release
// mode: release
// expect: 3 2 1 4
function main() {
  let counts = [0, 0, 0, 0];
  const words = ["get", "put", "post", "get", "head", "post", "get", "trace", "patch", "zzz"];
  for (const w of words) {
    switch (w) {
      case "get": counts[0] += 1; break;
      case "post": counts[1] += 1; break;
      case "put": counts[2] += 1; break;
      case "delete":
      case "head":
      case "options":
      case "trace":
      case "patch":
      case "connect":
      default: counts[3] += 1; break;
    }
  }
  console.log(counts[0], counts[1], counts[2], counts[3]);
}
