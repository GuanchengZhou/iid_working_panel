/** Convert AI-style TeX delimiters before Markdown consumes their backslashes.
 * Code and existing dollar-delimited math must remain byte-for-byte unchanged.
 */
export function normalizeMath(text: string): string {
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replace(
      /(^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\2[ \t]*(?=\n|$)|(?![\s\S])))|(`+)[^`]*?\3(?!`)|\$\$[\s\S]*?\$\$|(?<!\\)\$(?!\$)(?:\\.|[^$\n])*?\$|(?<!\\)\\\[([\s\S]*?)\\\]|(?<!\\)\\\(([^\n]*?)\\\)/gm,
      (match, code, fence, ticks, display, inline) => {
        if (display !== undefined) return `\n$$\n${display.trim()}\n$$\n`;
        if (inline !== undefined) return `$${inline.trim()}$`;
        return match;
      },
    );
}
