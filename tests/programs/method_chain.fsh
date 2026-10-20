class C {
  n = 1

  me(): C {
    return this
  }
}

function main() {
  const c = new C()
  print(c.me().me().me().me().me().me().me().me().me().me().me().me().me().me().me().me().me().me().me().me().me().me().me().me().me().me().n)
}
// expect: 1
