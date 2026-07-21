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
