/**
 * Finds where a JSON document first goes wrong, because JSON.parse error messages differ between
 * browsers and Node versions and don't always include a position.
 */
export function findJsonError(text: string): { position: number; message: string } | null {
  let i = 0;
  const fail = (message: string): never => {
    throw { position: i, message };
  };
  const ws = () => {
    while (i < text.length && " \t\n\r".includes(text[i] as string)) i++;
  };
  const describe = () => (i >= text.length ? "Unexpected end of input" : `Unexpected '${text[i]}'`);

  const string = () => {
    i++; // opening quote
    while (i < text.length) {
      const ch = text[i] as string;
      if (ch === '"') {
        i++;
        return;
      }
      if (ch === "\\") {
        i++;
        const esc = text[i];
        if (esc === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) fail("Invalid unicode escape");
          i += 5;
          continue;
        }
        if (esc === undefined || !'"\\/bfnrt'.includes(esc)) fail("Invalid escape character");
        i++;
        continue;
      }
      if (ch < " ") fail("Unescaped control character in string");
      i++;
    }
    fail("Unterminated string");
  };

  const value = (): void => {
    ws();
    const ch = text[i];
    if (ch === "{") {
      i++;
      ws();
      if (text[i] === "}") {
        i++;
        return;
      }
      for (;;) {
        ws();
        if (text[i] !== '"') fail(`${describe()}, expected a property name in double quotes`);
        string();
        ws();
        if (text[i] !== ":") fail(`${describe()}, expected ':'`);
        i++;
        value();
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") {
          i++;
          return;
        }
        fail(`${describe()}, expected ',' or '}'`);
      }
    }
    if (ch === "[") {
      i++;
      ws();
      if (text[i] === "]") {
        i++;
        return;
      }
      for (;;) {
        value();
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") {
          i++;
          return;
        }
        fail(`${describe()}, expected ',' or ']'`);
      }
    }
    if (ch === '"') {
      string();
      return;
    }
    const literal = /^(true|false|null|-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?)/.exec(text.slice(i));
    if (literal) {
      i += literal[0].length;
      return;
    }
    fail(describe());
  };

  try {
    value();
    ws();
    if (i < text.length) fail(`${describe()} after the end of the document`);
    return null;
  } catch (err) {
    return err as { position: number; message: string };
  }
}
