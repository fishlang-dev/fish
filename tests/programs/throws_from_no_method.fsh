// A class implementing From needs a static from.
class DbError { constructor(public code: i64) {} }
class ApiError implements From<DbError> {
  constructor(public status: i64) {}
}
function q(): i64 throws DbError { return 1 }
function h(): i64 throws ApiError { return q() }
function main() {}
// error: class 'ApiError' implements 'From<DbError>', so it needs 'static from(e: DbError): ApiError'
