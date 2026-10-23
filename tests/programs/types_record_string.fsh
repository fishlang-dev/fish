// error: 'Record<string, i64>' is a dictionary whose keys are only known at run time, which needs a Map type
// Record with string keys needs a Map type Fish doesn't have yet.
type Scores = Record<string, i64>;
function main() {}
