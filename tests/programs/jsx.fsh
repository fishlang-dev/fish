// case: jsx_element
// expect: <p class="note" id="n&lt;1&gt;" data-count="3" hidden>Hi Ann &amp; &lt;Bob&gt;, 3 of 2.5</p>
// expect: <p>plain</p>
// An element is an Html: text in braces is escaped, attributes are written out, a true one is its
// name alone, and a false or null one is left out.
function main() {
  const name = "Ann & <Bob>";
  const id = "n<1>";
  const count: i64 = 3;
  const off = false;
  const missing: string | null = null;
  const p = <p class="note" id={id} data-count={count} hidden={count > 2} disabled={off} title={missing}>Hi {name}, {count} of {2.5}</p>;
  console.log(p.toString());
  console.log(<p>{"plain"}</p>.toString());
}
// case: jsx_components
// expect: <div class="card"><h2>News</h2><p>one</p><p>two</p></div>
// expect: <div class="card"><h2>Empty</h2></div>
// expect: <footer>2026</footer>
// A name with a capital is a function called with its attributes as one object, its children as
// that object's children; one with neither is called with nothing.
type CardProps = { title: string; children?: Html };
function Card(props: CardProps): Html {
  return <div class="card"><h2>{props.title}</h2>{props.children}</div>;
}
function Footer(): Html {
  return <footer>{2026}</footer>;
}
function main() {
  const news = <Card title="News"><p>one</p><p>two</p></Card>;
  console.log(news.toString());
  console.log(<Card title={"Empty"} />.toString());
  console.log(<Footer />.toString());
}
// case: jsx_lists_and_fragments
// expect: <ul><li>a</li><li>b &amp; c</li></ul>
// expect: <b>x</b><i>y</i>
// expect: <p>some</p><p></p>
// An array of Html is each of them in turn, a fragment is its children, and null is nothing.
function main() {
  const items = ["a", "b & c"];
  const list = <ul>{items.map((item) => <li>{item}</li>)}</ul>;
  console.log(list.toString());
  const both = <><b>x</b><i>y</i></>;
  console.log(both.toString());
  const shown = items.length > 1;
  const maybe = <><p>{shown ? <>some</> : null}</p><p>{shown ? null : <>none</>}</p></>;
  console.log(maybe.toString());
}
// case: jsx_text
// expect: <p>one two <b>three</b> four</p>
// expect: <p> kept as written </p>
// expect: <p>&copy; 5 &lt; 6</p>
// Text over several lines is trimmed where it meets a line break and joined by a space; on one
// line it is kept as written, and an entity written out stays as it is.
function main() {
  const a = (
    <p>
      one
      two <b>three</b> four
    </p>
  );
  console.log(a.toString());
  console.log(<p> kept as written </p>.toString());
  console.log(<p>&copy; 5 &lt; 6</p>.toString());
}
// case: jsx_void_elements
// expect: <div><br><img src="a.png" alt="it's"><input disabled><span></span></div>
// An element with no content is written closed and has no closing tag in the markup.
function main() {
  const d = <div><br /><img src="a.png" alt="it's" /><input disabled /><span /></div>;
  console.log(d.toString());
}
// case: jsx_in_expressions
// expect: 3 <em>2</em> true
// expect: [<b>1</b>]
// An element stands wherever an expression does, and a comparison beside one is still one.
function wrap(h: Html): string {
  return `[${h.toString()}]`;
}
function main() {
  const n = 2;
  const less = 1 < n;
  console.log(n + 1, <em>{n}</em>.toString(), less);
  console.log(wrap(<b>{1}</b>));
}
// case: jsx_response
// expect: text/html; charset=utf-8
// expect: <h1>Hi</h1>
// Response.html sends a page's markup as HTML.
async function main() {
  const res = Response.html(<h1>Hi</h1>);
  console.log(res.headers.get("content-type"));
  const body = await res.text();
  console.log(body);
}
// case: jsx_closing_tag
// error: expected '</p>' to close '<p>', found '</div>'
function main() {
  const p = <p>text</div>;
}
// case: jsx_void_with_content
// error: '<br>' has no content, so it is written '<br />'
function main() {
  const p = <p>a<br>b</p>;
}
// case: jsx_spread_on_element
// error: '{...}' spreads an object into a component's props; an HTML element's attributes are each written out
function main() {
  const attrs = { id: "a" };
  const p = <p {...attrs}>text</p>;
}
// case: jsx_boolean_child
// error: E0101
// A boolean has no markup: write the element it decides, or null.
function main() {
  const on = true;
  const p = <p>{on}</p>;
}
// case: jsx_component_result
// error: E0101
// A component gives an Html, so a function giving a string isn't one.
function Plain(): string {
  return "<b>raw</b>";
}
function main() {
  const p = <p><Plain /></p>;
}
// case: jsx_never_closed
// error: this element is never closed
function main() {
  const p = <p>text;
}
// case: jsx_more_forms
// expect: <p>a</p>
// expect: [<b>x</b>]
// expect: <span class="badge">new</span>
// A comment alone in braces holds nothing, an element stands inside a template, and a name
// holding a dot is a component too.
class Ui {
  static Badge(props: { text: string }): Html {
    return <span class="badge">{props.text}</span>;
  }
}
function main() {
  console.log(<p>{/* nothing */}a{}</p>.toString());
  const x = "x";
  console.log(`[${<b>{x}</b>.toString()}]`);
  console.log(<Ui.Badge text="new" />.toString());
}
// case: jsx_assertion_still_parses
// mode: parse
// `<T>x` is still TypeScript's assertion, whatever follows it.
const a = <T>x;
const b = <string>y + 1;
const c = <A<B>>z.w;
const d = <const>["a"];
function f() { return <T>x; }
