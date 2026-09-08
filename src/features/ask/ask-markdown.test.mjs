import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";

import {
  askMarkdownRehypePlugins,
  askMarkdownRemarkPlugins,
} from "./ask-markdown.ts";

function renderMarkdown(markdown) {
  return renderToStaticMarkup(createElement(ReactMarkdown, {
    rehypePlugins: askMarkdownRehypePlugins,
    remarkPlugins: askMarkdownRemarkPlugins,
  }, markdown));
}

test("renders inline and display LaTeX without changing GFM or code", () => {
  const html = renderMarkdown([
    "Inline $E = mc^2$ and citation [1].",
    "",
    "$$",
    "\\int_0^1 x^2\\,dx = \\frac{1}{3}",
    "$$",
    "",
    "| A | B |",
    "| - | - |",
    "| 1 | 2 |",
    "",
    "`$not_math$`",
  ].join("\n"));

  assert.match(html, /class="katex"/);
  assert.match(html, /class="katex-display"/);
  assert.match(html, /<math/);
  assert.match(html, /href="#anchr-citation-1"/);
  assert.match(html, /<table>/);
  assert.match(html, /<code>\$not_math\$<\/code>/);
});

test("does not turn citation-like text inside LaTeX into a citation link", () => {
  const html = renderMarkdown("Formula $x_{[1]}$ and source [1].");
  const citationLinks = html.match(/href="#anchr-citation-1"/g) ?? [];

  assert.equal(citationLinks.length, 1);
});

test("does not turn array indexes into citation links", () => {
  const html = renderMarkdown("Array arr[1] stays code-like while source [1] remains a citation.");
  const citationLinks = html.match(/href="#anchr-citation-1"/g) ?? [];

  assert.equal(citationLinks.length, 1);
  assert.match(html, /arr\[1\]/);
});

test("keeps incomplete streaming LaTeX renderable as plain text", () => {
  const html = renderMarkdown("正在生成 $E = mc");

  assert.doesNotMatch(html, /class="katex"/);
  assert.match(html, /\$E = mc/);
});

test("keeps the rest of the answer visible when a LaTeX command is invalid", () => {
  const html = renderMarkdown("Before $\\definitelyNotACommand{x}$ after.");

  assert.match(html, /Before/);
  assert.match(html, /definitelyNotACommand/);
  assert.match(html, /after\./);
});


test("renders adjacent and repeated hierarchical citations after English identifiers", () => {
  const html = renderMarkdown("dimensions[1-1][2-1]。API Key 写入 metadata[2-1]。");
  assert.equal((html.match(/href="#anchr-citation-1-1"/g) ?? []).length, 1);
  assert.equal((html.match(/href="#anchr-citation-2-1"/g) ?? []).length, 2);
  assert.match(html, /dimensions<a href="#anchr-citation-1-1"/);
  assert.match(html, /metadata<a href="#anchr-citation-2-1"/);
});

test("hierarchical citations also follow digits and underscores without consuming text", () => {
  const html = renderMarkdown("版本2[1-1] field_[2-1]，中文[3-1]。");
  for (const label of ["1-1", "2-1", "3-1"]) assert.ok(html.includes(`href="#anchr-citation-${label}"`));
  assert.match(html, /版本2<a/);
  assert.match(html, /field_<a/);
});

test("does not transform hierarchical citations inside code, math or existing links", () => {
  const html = renderMarkdown([
    "`metadata[2-1]` and $x_{[2-1]}$.",
    "",
    "```text",
    "dimensions[1-1][2-1]",
    "```",
    "",
    "[source[2-1]](https://example.com) and actual source[2-1].",
  ].join("\n"));
  assert.equal((html.match(/href="#anchr-citation-2-1"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /href="#anchr-citation-1-1"/);
  assert.match(html, /<code>metadata\[2-1\]<\/code>/);
});

test("incomplete hierarchical markers remain text until closed", () => {
  assert.doesNotMatch(renderMarkdown("metadata[2-"), /href="#anchr-citation/);
  assert.match(renderMarkdown("metadata[2-1]"), /href="#anchr-citation-2-1"/);
});
