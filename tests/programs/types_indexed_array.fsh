// error: an array type is indexed by 'number', which gives its element type, here 'string'
type Tags = string[];
type First = Tags[0];
function main() {}
