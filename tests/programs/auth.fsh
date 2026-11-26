// case: auth_jwt
// JSON Web Tokens: HS256 round trips with expiry, audience and issuer checked, jwt.io's token
// verified with its secret, and every way a token is refused; then RS256, ES256 and EdDSA with
// PEM keys, each refusing a tampered signature and a key of the wrong kind.
// expect: 3 1234567890 true
// expect: refused algorithm
// expect: refused signature
// expect: refused audience
// expect: refused issuer
// expect: refused expired
// expect: refused notBefore
// expect: 1234567890
// expect: refused algorithm
// expect: refused malformed
// expect: refused claims
// expect: refused claims
// expect: RS256 k
// expect: refused signature
// expect: refused key
// expect: ES256 k
// expect: refused signature
// expect: refused key
// expect: EdDSA k
// expect: refused signature
// expect: refused key
// expect: refused key
import { signJwt, verifyJwt, JwtError, type JwtAlgorithm } from "std:auth";

type Claims = { sub: string; admin: boolean };

// Keys made for this test alone with openssl genpkey; they guard nothing.
const RSA = "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDdJ1ZdKNPwciPg\nxRz5M6JL/94od6JuxzuLHX5vI8XZabCLFLTNuKX+A3sjGo12fkmQEVBZJzmQisZp\nsQZI3kG6Ny0jBIrU74dtKMVtqqkceBNvXOQFqvho2NelgBLskv4LV9surZr38x8C\nqgqGVvbm4bk13FUAb2w+kj3AD7BCfo2rVZ3ZPC3sSVJNZvx7asNyL+YLe4KScYN9\nAzNJTFulBIofFViwtVhls7hBNuoApyfV5qY+uB3+VM116M6o3/2B/4l0l19h8rht\nuCXvwt0WTZHFXzOsF/6v6wJxTCQxzSyYgMxviOJZ2lAReYoXx58yCJOQdPECTWYo\nZH/lU529AgMBAAECggEACYOtPAHLKG+Iqp1gUzpM868U3DHVa6WnoqMIsvhbhTB+\nV2VzJ9yXS5fTvt1gE6Z4PLn59nPxDo5h3d8vUYg6VKwWBYkm/eU2MtSLtd2fO+nQ\nkDxzVOkXmc8ma+jYJ5RlWJCVjesLHTq47VDqdgAczC8O3EnX4FZq1kBNZstl/l5F\n9xEIMovK/LZvqH0uLTRGdQTyLrwv4gMVwtzEZqFwfkJ8yFMk3wjtquStFHk91ffJ\nezNzTK1Au1CORj793w82jmpGK+SoC9cof8ieeZS9GRePUuqBWR64RzUga/JbMae9\npGjydeI9ZLlVPB/wZ98CVsjFqDj5RXPcEeEo4WBUUwKBgQD10Ex6I9TxWzrQ9eOw\nEbn2tQSy/YysJZjDnQA90GAHrYxsesAnxVHGRZo3u0mZ2t29oWP6kKM/EhQtUXv6\n7hDfgKvqcHliU01hNjG10YNP2zD8ZZPAvT5upViGMh/mpC890EGKFchdwwsksC7A\nDfFaaQhLppLxpHsHTl3udFnXswKBgQDmUW8rpWyLjxDsTn5KJ0cNimwlU+c+0qHW\nn9Dn/5amhxxRI/Qcs3oGRR0ACGrbLtrxcnwtu+xWrU326oSyIWaw5t/7+esOrAXH\n5nqQyWE4iIvoRfqMWDZ02rsyGt/eN1IugerUl+JE2nowGvRk0V6UheSAqWfU7Qp7\nBa2E0T78zwKBgQCJ8/i3o1xih7yegSDjM0+WcUjN2xYTlpYBUh9MkaETLgbc6pbk\nuwyFpZJDLMzFl9tSDT065el4AAFq3Ywi63B0vpW84Jp+4BlRMUT8sTRsoKsBO1CM\nnqhnGExyI7dbjVEl87aUdF0aodejI21ZQ3nsL34EVtuo2ZJiK0z0AkBZmQKBgQDE\n5oHAMqBlf13caA6XnpSkAt8J2n0rvC8XqXGTpXJJ0+BljfM4Rkff7F4qlQelcp1D\nJbj78FjQkUDCAySGlP+R5Q9AABzwYihfCa9m8ILpLfNOE+Vq7k8//29iGo+hDnJ3\nyCHWtjJ+4rjrP2AIgOX227DKPgnCgxQesG/zyF+tCQKBgFQnPL/3hKIldh8Y1+Ld\nPqk8BNXxDq7ZOOAhOzcLGQTmqqz+QQsFN8vjJcyjRvqlK5gqK1y4TqSJzK1B3Q0N\nHfSkq4Xlj516AdS1J/gnrP7ARwXDTQSyPZKnXDMQIaYT2F4bP1SzUl+oAt/9wuwB\nfbeGXPJ+AIOi4l51ieJMPsY2\n-----END PRIVATE KEY-----\n";
const RSA_PUB = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3SdWXSjT8HIj4MUc+TOi\nS//eKHeibsc7ix1+byPF2WmwixS0zbil/gN7IxqNdn5JkBFQWSc5kIrGabEGSN5B\nujctIwSK1O+HbSjFbaqpHHgTb1zkBar4aNjXpYAS7JL+C1fbLq2a9/MfAqoKhlb2\n5uG5NdxVAG9sPpI9wA+wQn6Nq1Wd2Twt7ElSTWb8e2rDci/mC3uCknGDfQMzSUxb\npQSKHxVYsLVYZbO4QTbqAKcn1eamPrgd/lTNdejOqN/9gf+JdJdfYfK4bbgl78Ld\nFk2RxV8zrBf+r+sCcUwkMc0smIDMb4jiWdpQEXmKF8efMgiTkHTxAk1mKGR/5VOd\nvQIDAQAB\n-----END PUBLIC KEY-----\n";
const EC = "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg9m42V4H9l7t42BSg\n+QELAs9nQvPpAHhv6KRjtxyfJ8uhRANCAAQ+rqI+zP72xI97LhQdUYBYwmPaswoV\nia5jwmEqvzswYkUtTuZLBL9ELKrr+aqoIQarZFYsMRITrKVt3B6eGE9F\n-----END PRIVATE KEY-----\n";
const EC_PUB = "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEPq6iPsz+9sSPey4UHVGAWMJj2rMK\nFYmuY8JhKr87MGJFLU7mSwS/RCyq6/mqqCEGq2RWLDESE6ylbdwenhhPRQ==\n-----END PUBLIC KEY-----\n";
const ED = "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEICdccPUudaLoNOVAWdQYgYsmffc2rrNob9PaP0H/D0/P\n-----END PRIVATE KEY-----\n";
const ED_PUB = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAeEiaXeLNgqVBHsRtJxxYYAkvZnW1aFa4S/+FlU0Rpss=\n-----END PUBLIC KEY-----\n";

function show(f: () => string throws JwtError): void {
  try {
    console.log(f());
  } catch (e) {
    console.log("refused", e.code);
  }
}

function main(): void throws JwtError {
  const secret = "a-string-secret-at-least-256-bits-long";
  const t = signJwt({ sub: "1234567890", admin: true }, secret, { expiresIn: 60, audience: "app", issuer: "fish" });
  const c = verifyJwt<Claims>(t, secret, { algorithms: ["HS256"], audience: "app", issuer: "fish" });
  console.log(t.split(".").length, c.sub, c.admin);
  show(() => verifyJwt<Claims>(t, secret, { algorithms: ["HS384", "HS512"] }).sub);
  show(() => verifyJwt<Claims>(t, "another-secret", { algorithms: ["HS256"] }).sub);
  show(() => verifyJwt<Claims>(t, secret, { algorithms: ["HS256"], audience: "other" }).sub);
  show(() => verifyJwt<Claims>(t, secret, { algorithms: ["HS256"], issuer: "other" }).sub);
  const old = signJwt({ sub: "x", admin: false }, secret, { expiresIn: -10 });
  show(() => verifyJwt<Claims>(old, secret, { algorithms: ["HS256"] }).sub);
  const later = signJwt({ sub: "x", admin: false }, secret, { notBefore: 600 });
  show(() => verifyJwt<Claims>(later, secret, { algorithms: ["HS256"] }).sub);
  const known = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiYWRtaW4iOnRydWUsImlhdCI6MTUxNjIzOTAyMn0.KMUFsIDTnFmyG3nMiGM6H9FNFUROf3wh7SmqJp-QV30";
  show(() => verifyJwt<Claims>(known, secret, { algorithms: ["HS256"] }).sub);
  show(() => verifyJwt<Claims>("eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJ4In0.", secret, { algorithms: ["HS256"] }).sub);
  show(() => verifyJwt<Claims>("not.a-token", secret, { algorithms: ["HS256"] }).sub);
  show(() => String(verifyJwt<{ sub: i64 }>(known, secret, { algorithms: ["HS256"] }).sub));
  show(() => signJwt({ exp: 1 }, secret, { expiresIn: 60 }));
  const algs: JwtAlgorithm[] = ["RS256", "ES256", "EdDSA"];
  const keys = [RSA, EC, ED];
  const pubs = [RSA_PUB, EC_PUB, ED_PUB];
  for (let i: usize = 0; i < 3; i++) {
    const a = algs[i];
    const name: string = a;
    const s = signJwt({ sub: "k", admin: true }, keys[i], { alg: a });
    show(() => name + " " + verifyJwt<Claims>(s, pubs[i], { algorithms: [a] }).sub);
    show(() => verifyJwt<Claims>(s.slice(0, -4) + (s.endsWith("AAAA") ? "BBBB" : "AAAA"), pubs[i], { algorithms: [a] }).sub);
    show(() => verifyJwt<Claims>(s, pubs[(i + 1) % 3], { algorithms: [a] }).sub);
  }
  show(() => signJwt({ sub: "k" }, RSA_PUB, { alg: "RS256" }));
}
// case: auth_password
// Password hashes: argon2id made and checked, and reference hashes read back, argon2id from its
// reference implementation's tests and scrypt from Python's hashlib; a malformed hash refused.
// expect: $argon2id$v=19$m=19456,t=2,p=1$ 22 43
// expect: true false
// expect: true false
// expect: true false
// expect: the hash isn't an argon2id or scrypt PHC string
// expect: the argon2id hash's parameters are out of range
import { hashPassword, verifyPassword, PasswordError } from "std:auth";

async function main(): Promise<void> throws PasswordError {
  const h = await hashPassword("hunter2");
  const f = h.split("$");
  console.log(h.slice(0, 31), f[4].length, f[5].length);
  const yes = await verifyPassword("hunter2", h);
  const no = await verifyPassword("hunter3", h);
  console.log(yes, no);
  const reference = "$argon2id$v=19$m=65536,t=2,p=1$c29tZXNhbHQ$CTFhFdXPJO1aFaMaO6Mm5c8y7cJHAph8ArZWb2GRPPc";
  const a = await verifyPassword("password", reference);
  const b = await verifyPassword("Password", reference);
  console.log(a, b);
  const scrypt = "$scrypt$ln=14,r=8,p=1$c2FsdHNhbHRzYWx0c2FsdA$5JKn5olKLcgKz87v9U92hFmVFTMZ+VhsM3rYatizw04";
  const c = await verifyPassword("hunter2", scrypt);
  const d = await verifyPassword("hunter", scrypt);
  console.log(c, d);
  for (const bad of ["$2b$10$abcdefghijklmnopqrstuv", "$argon2id$v=19$m=999999999,t=2,p=1$c29tZXNhbHQ$CTFhFdXPJO1aFaMaO6Mm5c8y7cJHAph8ArZWb2GRPPc"]) {
    try {
      const r = await verifyPassword("x", bad);
      console.log(r);
    } catch (e) {
      console.log(e.message);
    }
  }
}

// case: auth_password_sync
// The sync forms give what the async ones give, from code with no runtime running.
// expect: $argon2id$v=19$m=19456,t=2,p=1$ 22 43
// expect: true false
// expect: true
// expect: the hash isn't an argon2id or scrypt PHC string
import { hashPasswordSync, verifyPasswordSync, PasswordError } from "std:auth";

function main(): void throws PasswordError {
  const h = hashPasswordSync("hunter2");
  const f = h.split("$");
  console.log(h.slice(0, 31), f[4].length, f[5].length);
  console.log(verifyPasswordSync("hunter2", h), verifyPasswordSync("hunter3", h));
  console.log(verifyPasswordSync("password", "$argon2id$v=19$m=65536,t=2,p=1$c29tZXNhbHQ$CTFhFdXPJO1aFaMaO6Mm5c8y7cJHAph8ArZWb2GRPPc"));
  try {
    console.log(verifyPasswordSync("x", "$2b$10$abcdefghijklmnopqrstuv"));
  } catch (e) {
    console.log(e.message);
  }
}
