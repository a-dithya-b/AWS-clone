const cache = new Map<string, RegExp>();

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Converts an AWS wildcard pattern into a regex source: `*` = any run, `?` = one character. */
export function wildcardToRegexSource(pattern: string): string {
  let out = "";
  for (const ch of pattern) {
    if (ch === "*") out += ".*";
    else if (ch === "?") out += ".";
    else out += escapeRegex(ch);
  }
  return out;
}

export function escapeLiteral(text: string): string {
  return escapeRegex(text);
}

export function compileRegex(source: string, caseInsensitive: boolean): RegExp {
  const key = `${caseInsensitive ? "i" : "s"}:${source}`;
  let re = cache.get(key);
  if (!re) {
    re = new RegExp(`^${source}$`, caseInsensitive ? "is" : "s");
    if (cache.size > 5000) cache.clear();
    cache.set(key, re);
  }
  return re;
}

/** Glob match with AWS semantics: `*` = any run of characters, `?` = exactly one character. */
export function matchesPattern(
  pattern: string,
  value: string,
  opts: { caseInsensitive: boolean },
): boolean {
  return compileRegex(wildcardToRegexSource(pattern), opts.caseInsensitive).test(value);
}
