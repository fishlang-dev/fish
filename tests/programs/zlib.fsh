// case: zlib_max_output_length
// expect: RangeError ERR_BUFFER_TOO_LARGE Cannot create a Buffer larger than 100 bytes
// expect: 5000
import { gunzipSync, gzipSync, ZlibError } from "node:zlib";
function main() throws ZlibError {
  const packed = gzipSync("x".repeat(5000));
  try {
    gunzipSync(packed.clone(), { maxOutputLength: 100 });
  } catch (e) {
    console.log(e.name, e.code, e.message);
  }
  const out = gunzipSync(packed, { maxOutputLength: 5000 });
  console.log(out.length);
}
