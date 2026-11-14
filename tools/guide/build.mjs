// Turns docs/GUIDE.md into a stand-alone HTML page in the style of the landing page (stickler.julianlorenzon.com),
// so the guide has one source. Knows only what the guide uses: #/##/### headings, paragraphs, - and 1. lists,
// **bold**, `code`, [links](url).
// usage: node tools/guide/build.mjs [docs/GUIDE.md] <out.html>
import { readFileSync, writeFileSync } from "node:fs";

const [src, out] = process.argv.length > 3 ? process.argv.slice(2) : ["docs/GUIDE.md", process.argv[2]];
if (!out) throw new Error("usage: node tools/guide/build.mjs [docs/GUIDE.md] <out.html>");

const esc = (t) => t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const inline = (t) =>
  esc(t)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

const html = [];
let title = "How to use Stickler";
let para = [];
let list; // { tag, items: string[] }
const flushPara = () => {
  if (para.length) html.push(`  <p>${inline(para.join(" "))}</p>`);
  para = [];
};
const flushList = () => {
  if (list) html.push(`  <${list.tag}>\n${list.items.map((i) => `    <li>${inline(i)}</li>`).join("\n")}\n  </${list.tag}>`);
  list = undefined;
};
for (const line of readFileSync(src, "utf8").split("\n")) {
  const h = line.match(/^(#{1,3}) (.*)$/);
  const li = line.match(/^(-|\d+\.) (.*)$/);
  if (h) {
    flushPara();
    flushList();
    if (h[1] === "#") title = h[2];
    html.push(`  <h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
  } else if (li) {
    flushPara();
    const tag = li[1] === "-" ? "ul" : "ol";
    if (list && list.tag !== tag) flushList();
    list ??= { tag, items: [] };
    list.items.push(li[2]);
  } else if (line.startsWith("  ") && list) {
    list.items[list.items.length - 1] += " " + line.trim();
  } else if (line.trim() === "") {
    flushPara();
    flushList();
  } else {
    flushList();
    para.push(line.trim());
  }
}
flushPara();
flushList();

writeFileSync(
  out,
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="How to design, print and calibrate labels with Stickler on the Fichero D11s and MXW01 printers.">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<!-- Made from docs/GUIDE.md in the Stickler repository by tools/guide/build.mjs; edit the guide there, not here -->
<style>
  :root { color-scheme: light dark; --accent: #ff5a36; --fg: #16181a; --muted: #5b6168; --bg: #ffffff; --line: #e4e7eb; }
  @media (prefers-color-scheme: dark) { :root { --fg: #e4e7eb; --muted: #a9afb6; --bg: #161819; --line: #2a2d30; } }
  body { margin: 0; background: var(--bg); color: var(--fg);
    font: 17px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 42rem; margin: 0 auto; padding: 2rem 1.25rem 2rem; }
  .back { font-size: .95rem; }
  h1 { font-size: 2rem; line-height: 1.2; margin: 1rem 0 .25rem; }
  h1::after { content: ""; display: block; width: 3rem; height: 4px; background: var(--accent); margin-top: .75rem; }
  h2 { font-size: 1.2rem; margin: 2.25rem 0 .5rem; }
  h3 { font-size: 1.05rem; margin: 1.5rem 0 .5rem; }
  ul, ol { padding-left: 1.25rem; }
  li { margin: .4rem 0; }
  code { font-size: .9em; padding: .05em .3em; border-radius: 4px; background: var(--line); }
  a { color: var(--accent); }
  footer { max-width: 42rem; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; border-top: 1px solid var(--line);
    color: var(--muted); font-size: .95rem; }
  footer a { margin-right: 1.25rem; }
</style>
</head>
<body>
<main>
  <a class="back" href="/">← Stickler</a>
${html.join("\n")}
</main>
<footer>
  <a href="/">Stickler</a>
  <a href="/privacy-policy.html">Privacy policy</a>
  <a href="https://github.com/JulianLorenzon/stickler">Source code</a>
  <a href="mailto:apps@julianlorenzon.com">apps@julianlorenzon.com</a>
</footer>
</body>
</html>
`,
);
console.log("written", out);
