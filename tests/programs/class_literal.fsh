class User {
  id: i64
  admin: boolean

  constructor(id: i64) {
    this.id = id
    this.admin = id === 0
  }

  label(): i64 {
    return this.admin ? -this.id : this.id
  }
}

class Team {
  size = 1

  constructor(public lead: User) {}
}

function describe(u: User): i64 {
  return u.label()
}

function main() {
  const u: User = { id: 7, admin: true }
  print(u.id, u.admin, u.label())
  print(describe({ admin: false, id: 3 }))
  const admin = false
  const id = 4
  const v: User = { id, admin }
  print(v.label())
  // A nested literal builds the class of its field.
  const t: Team = { size: 2, lead: { id: 9, admin: false } }
  print(t.lead.label(), t.size)
  let w: User = new User(0)
  w = { id: 5, admin: true }
  print(w.label())
}
// expect: 7 true -7
// expect: 3
// expect: 4
// expect: 9 2
// expect: -5
