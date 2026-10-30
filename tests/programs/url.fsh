// case: url_parts
// Each part of a parsed URL, read through its getters.
function main(): void throws TypeError {
  const u = new URL("HTTPS://user:p%40ss@Example.COM:8443/a/./b/../c d?q=1&r#top");
  console.log(u.href);
  console.log(u.origin, u.protocol, u.username, u.password);
  console.log(u.host, u.hostname, u.port);
  console.log(u.pathname, u.search, u.hash);
  console.log(u.toString() === u.href, u.toJSON() === u.href);
  const plain = new URL("http://example.com:80");
  console.log(plain.href, plain.port.length, plain.search.length, plain.hash.length);
  const opaque = new URL("mailto:someone@example.com");
  console.log(opaque.origin, opaque.host.length, opaque.pathname);
}
// expect: https://user:p%40ss@example.com:8443/a/c%20d?q=1&r#top
// expect: https://example.com:8443 https: user p%40ss
// expect: example.com:8443 example.com 8443
// expect: /a/c%20d ?q=1&r #top
// expect: true true
// expect: http://example.com/ 0 0 0
// expect: null 0 someone@example.com
// case: url_relative
// A relative URL against a base, given as a string or as a URL.
function main(): void throws TypeError {
  console.log(new URL("../api?x=1", "https://example.com/docs/guide/").href);
  const base = new URL("https://example.com/docs/guide/page#s");
  console.log(new URL("/root", base.clone()).href);
  console.log(new URL("?only", base.clone()).href);
  console.log(new URL("//other.org/x", base.clone()).href);
  console.log(new URL("#frag", base).href);
  console.log(new URL("file.txt", "file:///C:/dir/").href);
}
// expect: https://example.com/docs/api?x=1
// expect: https://example.com/root
// expect: https://example.com/docs/guide/page?only
// expect: https://other.org/x
// expect: https://example.com/docs/guide/page#frag
// expect: file:///C:/dir/file.txt
// case: url_parse_and_can_parse
// URL.parse gives null and URL.canParse false for what isn't a URL.
function main() {
  console.log(URL.parse("not a url") === null, URL.canParse("not a url"));
  console.log(URL.parse("/relative") === null, URL.canParse("/relative", "http://h"));
  const u = URL.parse("http://h/x");
  if (u !== null) console.log(u.pathname);
  console.log(URL.canParse("http://[::1"), URL.canParse("http://h:65536"));
}
// expect: true false
// expect: true true
// expect: /x
// expect: false false
// case: url_type_error
// A bad URL throws a TypeError, which instanceof tells apart.
function check(input: string): string throws TypeError {
  return new URL(input).href;
}
function main() {
  try {
    console.log(check("http://ok/"));
    console.log(check("http://exa mple.com/"));
  } catch (e) {
    if (e instanceof TypeError) console.log(e.name + ":", e.message);
  }
}
// expect: http://ok/
// expect: TypeError: Invalid URL
// case: url_hosts
// IPv4 in any numeric form and IPv6 come out normalized.
function main(): void throws TypeError {
  console.log(new URL("http://0x7f.1/").hostname, new URL("http://2130706433/").hostname, new URL("http://0300.0250.0.1/").hostname);
  console.log(new URL("http://[0:0:0:0:0:0:0:1]:8080/").host, new URL("http://[2001:DB8:0:0:1:0:0:1]/").hostname);
  console.log(new URL("http://[::ffff:192.168.0.1]/").hostname);
  console.log(URL.canParse("http://1.2.3.256/"), URL.canParse("http://[1:2:3:4:5:6:7:8:9]/"));
}
// expect: 127.0.0.1 127.0.0.1 192.168.0.1
// expect: [::1]:8080 [2001:db8::1:0:0:1]
// expect: [::ffff:c0a8:1]
// expect: false false
// case: url_international_domain
// A host outside ASCII needs international domain names, which aren't supported yet.
function main() {
  try {
    const u = new URL("https://café.example/menu");
    console.log(u.href);
  } catch (e) {
    console.log(e.message);
  }
  const path = URL.parse("https://example.com/café");
  if (path !== null) console.log(path.pathname);
}
// expect: Invalid URL: international domain names aren't supported yet
// expect: /caf%C3%A9
// case: url_search_params
// Each method of URLSearchParams, from a query string or from pairs.
function main() {
  let p = new URLSearchParams("?a=1&b=x+y&a=2&c=caf%C3%A9&d&=e&%zz=%41");
  console.log(p.get("a"), p.get("b"), p.get("c"), p.get("d"), p.get(""), p.get("%zz"));
  console.log(p.get("missing") === null, p.getAll("a").join(","), p.has("d"), p.has("a", "2"), p.has("a", "3"), p.size);
  p.append("a", "3");
  p.set("b", "one & two");
  p.delete("c");
  p.delete("a", "2");
  console.log(p.toString());
  p.sort();
  console.log(p.keys().join(","), p.values().join(","));
  p.forEach((value: string, name: string) => { console.log(name + "=" + value); });
  for (const [name, value] of p.entries()) console.log(name, value);
  const pairs: [string, string][] = [["sp ace", "\u00e9/?&="], ["*-._", "~!'()"]];
  const q = new URLSearchParams(pairs);
  console.log(q.toString(), new URLSearchParams().toString().length);
}
// expect: 1 x y café  e A
// expect: true 1,2 true true false 7
// expect: a=1&b=one+%26+two&d=&=e&%25zz=A&a=3
// expect: ,%zz,a,a,b,d e,A,1,3,one & two,
// expect: =e
// expect: %zz=A
// expect: a=1
// expect: a=3
// expect: b=one & two
// expect: d=
// expect:  e
// expect: %zz A
// expect: a 1
// expect: a 3
// expect: b one & two
// expect: d 
// expect: sp+ace=%C3%A9%2F%3F%26%3D&*-._=%7E%21%27%28%29 0
// case: url_search_params_live
// A URL's searchParams change its search and href, and the last one deleted clears search.
function main(): void throws TypeError {
  let url = new URL("https://example.com/list?page=2#top");
  url.searchParams.set("page", "3");
  url.searchParams.append("q", "a b");
  console.log(url.search, url.href);
  url.searchParams.sort();
  console.log(url.search);
  url.searchParams.delete("page");
  url.searchParams.delete("q");
  console.log(url.search.length, url.href);
  const empty = new URL("http://h/?");
  console.log(empty.href, empty.search.length, empty.searchParams.size);
  // Parsed as written, until a param changes.
  let raw = new URL("http://h/?a=%7e&b=c d");
  console.log(raw.search, raw.searchParams.get("a"));
  raw.searchParams.set("b", "e");
  console.log(raw.search);
}
// expect: ?page=3&q=a+b https://example.com/list?page=3&q=a+b#top
// expect: ?page=3&q=a+b
// expect: 0 https://example.com/list#top
// expect: http://h/? 0 0
// expect: ?a=%7e&b=c%20d ~
// expect: ?a=%7E&b=e
// case: url_search_params_read_only
// A URL's searchParams change in place, even through a const, but can't be replaced.
function main(): void throws TypeError {
  const url = new URL("http://h/?a=1");
  url.searchParams.append("b", "2");
  console.log(url.href);
  url.searchParams = new URLSearchParams("c=3");
}
// error: cannot assign to 'searchParams' because it is a read-only property
// case: url_search_params_link_hidden
// The link between params and their URL can't be reached from a program.
function main() {
  const p = new URLSearchParams("a=1");
  console.log(p.__urlChanged);
}
// error: property '__urlChanged' does not exist on type 'URLSearchParams'
// case: url_clone
// A URL and its params clone into copies that change apart.
function main(): void throws TypeError {
  const base = new URL("http://h/dir/page?a=1");
  base.searchParams.set("a", "2");
  const copy = base.clone();
  copy.searchParams.append("b", "3");
  console.log(base.href, copy.href);
  console.log(new URL("other", base.clone()).href, new URL("?q", base).href);
  const p = new URLSearchParams("x=1");
  const q = p.clone();
  q.append("y", "2");
  console.log(p.toString(), q.toString());
}
// expect: http://h/dir/page?a=2 http://h/dir/page?a=2&b=3
// expect: http://h/dir/other http://h/dir/page?q
// expect: x=1 x=1&y=2
// case: url_own_type_error
// expect: TypeError Invalid URL
// expect: mine
// std's URL still throws std's TypeError in a program with its own.
class TypeError { describe(): string { return "mine"; } }
function main() {
  try {
    const u = new URL("nope");
    console.log(u.href);
  } catch (e) {
    console.log(e.name, e.message);
  }
  console.log(new TypeError().describe());
}
// case: url_own_const
// expect: 7 a=1
// A program's own URL constant is the one it names, beside std's URLSearchParams.
const URL = 7;
function main() {
  console.log(URL, new URLSearchParams("a=1").toString());
}
// case: url_own_const_http
// expect: 7 200
// A program's own URL constant works beside the HTTP library.
const URL = 7;
async function main(): Promise<void> {
  console.log(URL, new Response("hi").status);
}
// case: url_own_const_type_error
// expect: TypeError Invalid URL 5
// std's URL still throws std's TypeError in a program with a TypeError constant of its own.
const TypeError = 5;
function main() {
  try {
    const u = new URL("nope");
    console.log(u.href);
  } catch (e) {
    console.log(e.name, e.message, TypeError);
  }
}
// case: url_search_params_from_pairs
// expect: a=1&b=2
// expect: 2
function main() {
  const p = new URLSearchParams([["a", "1"], ["b", "2"]]);
  console.log(p.toString());
  console.log(p.get("b"));
}
