// error: an array type is indexed by 'number', as in 'string[][number]', which gives its element type
type Tags = string[];
type First = Tags[0];
function main() {}
