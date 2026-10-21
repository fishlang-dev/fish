// An error the declared type doesn't take is wrapped by a class implementing From for it, when propagating and when thrown.
class DbError {
  constructor(public code: i64) {}
}
class ApiError implements From<DbError>, From<boolean> {
  constructor(public status: i64) {}
  static from(e: DbError | boolean): ApiError {
    if (typeof e === "boolean") return new ApiError(400)
    return new ApiError(500 + e.code)
  }
}
function query(n: i64): i64 throws DbError {
  if (n < 0) throw new DbError(7)
  return n
}
function handler(n: i64): i64 throws ApiError {
  return query(n) * 2
}
function strict(b: boolean): i64 throws ApiError {
  if (b) throw new DbError(1)
  throw true
}
function main() {
  try {
    print(handler(4))
    print(handler(-1))
  } catch (e) {
    print("api", e.status)
  }
  try {
    strict(true)
  } catch (e) {
    print("api", e.status)
  }
  try {
    strict(false)
  } catch (e) {
    print("api", e.status)
  }
}
// expect: 8
// expect: api 507
// expect: api 501
// expect: api 400
