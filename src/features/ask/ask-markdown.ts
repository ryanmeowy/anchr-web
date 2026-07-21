import type { Options as ReactMarkdownOptions } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

type MarkdownPluginList = NonNullable<ReactMarkdownOptions["remarkPlugins"]>;

type MarkdownAstNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownAstNode[];
};

export const askMarkdownRemarkPlugins: MarkdownPluginList = [
  remarkGfm,
  remarkMath,
  remarkInlineCitations,
];

export const askMarkdownRehypePlugins: MarkdownPluginList = [
  [rehypeKatex, { output: "htmlAndMathml", strict: "ignore" }],
];

function remarkInlineCitations() {
  return (tree: unknown) => {
    if (isMarkdownNode(tree) && tree.children) transformCitationTextNodes(tree);
  };
}

function transformCitationTextNodes(parent: MarkdownAstNode) {
  if (!parent.children) return;
  const transformed: MarkdownAstNode[] = [];

  parent.children.forEach((node) => {
    if (node.type === "text" && node.value) {
      transformed.push(...splitCitationText(node.value));
      return;
    }
    if (node.children && node.type !== "link" && node.type !== "linkReference") {
      transformCitationTextNodes(node);
    }
    transformed.push(node);
  });

  parent.children = transformed;
}

function splitCitationText(value: string) {
  const nodes: MarkdownAstNode[] = [];
  const citationPattern = /\[(\d+(?:-\d+)?)]/g;
  let cursor = 0;
  let match = citationPattern.exec(value);

  while (match) {
    if (match.index > cursor) nodes.push({ type: "text", value: value.slice(cursor, match.index) });
    nodes.push({
      type: "link",
      url: `#anchr-citation-${match[1]}`,
      children: [{ type: "text", value: match[0] }],
    });
    cursor = match.index + match[0].length;
    match = citationPattern.exec(value);
  }

  if (cursor < value.length) nodes.push({ type: "text", value: value.slice(cursor) });
  return nodes.length ? nodes : [{ type: "text", value }];
}

function isMarkdownNode(value: unknown): value is MarkdownAstNode {
  return typeof value === "object" && value !== null && "type" in value;
}
