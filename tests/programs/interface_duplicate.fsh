interface Named {
  name: i64
}

interface Labelled extends Named {
  name: boolean
}

function main() {}
// error: duplicate member 'name' in interface 'Labelled'
