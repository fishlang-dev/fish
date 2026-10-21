type O = { name: string; tags: string[] };
function main() {
  let o: O = { name: "n" + 1, tags: ["t" + 1] };
  o |> match (%) {
    case { tags } => { o = { name: "z", tags: [] }; console.log(tags[0]); },
  };
}
// error: cannot change 'o' while 'tags' borrows 'o'
