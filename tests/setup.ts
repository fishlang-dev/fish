import { mathObjects } from "../src/mathlib.ts";
import { cachedSession } from "../src/stdcache.ts";

const session = cachedSession();

// Every program links the Math runtime, which is compiled once into a cache; doing it here
// keeps its seconds out of whichever test happens to build first.
mathObjects(session);
