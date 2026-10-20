// mode: parse
function f() {
  let result = input
    |> parse(%)
    |> validate(%, rules)
    |> % ?? fallback
  let squared = 5 |> % * %
  let remainder = 10 |> % % 3
  let nested = list |> map(%, (x) => x |> double(%))
  let chained = value |> f(%) |> g(%) |> h(%)
}
