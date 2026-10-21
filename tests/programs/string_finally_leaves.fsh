function f(): string throws string {
  try {
    throw "e" + 1;
  } finally {
    return "r" + 2;
  }
}

function g(): string {
  try {
    return "a" + 1;
  } finally {
    return "b" + 2;
  }
}

function h(): i64 {
  for (let i = 0; i < 3; i++) {
    try {
      return i;
    } finally {
      break;
    }
  }
  return 9;
}

function main() throws string {
  console.log(f(), g(), h());
}
// expect: r2 b2 9
