enum Shape {
  Circle(f64),
  Label(string),
  Many(i64),
}

class Oops {
  why: string;
  constructor(why: string) {
    this.why = why;
  }
}

function describe(s: Shape): string {
  const out = match (s) {
    case Circle(r) => {
      if (r > 10.0) return "big";
      const name = "circle";
      return name + " " + r;
    },
    case Label(text) => {
      let joined = "";
      for (let i = 0; i < 3; i++) {
        joined += text;
        if (joined.length > 4) return "long " + joined;
      }
      return joined;
    },
    case Many(n) => {
      let total = 0;
      let i = 0;
      while (true) {
        i++;
        if (i > n) break;
        total += i;
      }
      return "sum " + total;
    },
  };
  // A return in an arm never leaves the function.
  return "<" + out + ">";
}

function nested(a: i64, b: i64): string {
  return match (a) {
    case 0 => {
      const inner = match (b) {
        case 0 => {
          return "zero zero";
        },
        case _ => "zero " + b,
      };
      return inner + "!";
    },
    case _ => "other",
  };
}

function risky(n: i64): string throws Oops {
  const s = "kept";
  return s + match (n) {
    case 0 => {
      try {
        if (n === 0) throw new Oops("inner");
        return "unreached";
      } catch (e) {
        return "caught " + e.why;
      } finally {
        console.log("finally ran");
      }
    },
    case 1 => {
      throw new Oops("outer " + "temp");
    },
    case _ => "plain",
  };
}

function main() throws Oops {
  console.log(describe(Shape.Circle(2.0)), describe(Shape.Circle(20.0)));
  console.log(describe(Shape.Label("ab")), describe(Shape.Label("x")), describe(Shape.Many(4)));
  console.log(nested(0, 0), nested(0, 5), nested(1, 0));
  console.log(risky(0), risky(2));
  try {
    console.log(risky(1));
  } catch (e) {
    console.log("error " + e.why);
  }
  const prefix = "p";
  match (prefix + "q") {
    case "pq" => {
      console.log("statement arm");
      return;
    },
    case _ => {
      console.log("no");
    },
  }
  console.log("after", prefix);
}
// expect: <circle 2> <big>
// expect: <long ababab> <xxx> <sum 10>
// expect: zero zero! zero 5! other
// expect: finally ran
// expect: keptcaught inner keptplain
// expect: error outer temp
// expect: statement arm
// expect: after p
