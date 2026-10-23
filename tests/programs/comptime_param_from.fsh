// error: 'ApiError.from' wraps errors as they are raised at run time, so it can't take a comptime parameter
// A From wrapper is given each error as it is raised, at run time.
class DbError { constructor(public code: i64) {} }
class ApiError implements From<i64> {
  constructor(public status: i64) {}
  static from(comptime e: i64): ApiError { return new ApiError(500 + e); }
}
function h(): i64 throws ApiError { throw 3; }
function main() { try { console.log(h()); } catch (e) { console.log(e.status); } }
