import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import { normalizeMath } from "../src/math-markdown.ts";
const render = (text: string) => renderToStaticMarkup(createElement(ReactMarkdown, {
  remarkPlugins: [remarkGfm, remarkMath],
  rehypePlugins: [[rehypeKatex, {strict: false, trust: false}]],
  children: normalizeMath(text),
}));
test("AI TeX delimiters and Markdown math render fractions, matrices and aligned equations", () => {
  const html = render(String.raw`行内 \(x_i^2 + \alpha\)，以及 $\beta$。

\[\begin{aligned} L &= \sum_{i=1}^n x_i^2 \\ A &= \begin{bmatrix}1&2\\3&4\end{bmatrix}\end{aligned}\]

$$
\frac{\partial L}{\partial x}=2x
$$`);
  assert.equal((html.match(/class="katex"/g) || []).length, 4);
  assert.equal((html.match(/class="katex-display"/g) || []).length, 2);
  assert.doesNotMatch(html, /katex-error/);
  assert.match(html, /<math/);
});
test("code examples, dollar math and incomplete streaming delimiters are preserved", () => {
  for (const code of ["`\\(x\\)`", "```latex\n\\[x\\]\n```", "~~~text\n\\(x\\)\n~~~", "```latex\n\\[x\\]", String.raw`$\text{use \(x\)}$`, String.raw`$$\text{use \[x\]}$$`]) {
    assert.equal(normalizeMath(code), code);
  }
  assert.equal(normalizeMath(String.raw`未完成 \(x_i`), String.raw`未完成 \(x_i`);
  const code = render("```latex\n\\[x\\]\n```");
  assert.doesNotMatch(code, /class="katex"/);
  assert.match(code, /language-latex/);
});
test("invalid formula degrades locally and untrusted math cannot inject HTML", () => {
  const html = render(String.raw`$\frac{1}{$ 后面的内容仍然存在。 $\href{javascript:alert(1)}{click}$`);
  assert.match(html, /katex-error/);
  assert.match(html, /后面的内容仍然存在/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(render("[第 2 页](paper-page:2)\n\n|变量|公式|\n|--|--|\n|速度|$v_i$|"), /<table>/);
});
