// An error that neither fits nor wraps needs converting.
class ApiError { constructor(public status: i64) {} }
function q(): i64 throws boolean { return 1 }
function h(): i64 throws ApiError {
  return q()
}
function main() {}
// error: 'q' can throw 'boolean', which isn't the 'ApiError' that 'h' throws; convert it, or have 'ApiError' implement 'From<boolean>'
