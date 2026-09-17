type TokenType = "NUMBER" | "PLUS" | "MINUS" | "STAR" | "SLASH" | "PERCENT" | "LPAREN" | "RPAREN" | "EOF";

type Token = { type: TokenType; value: string };

// `percent` marks a bare `%` result whose percent meaning is still live: it can
// still act as a percentage of the left base of a following `+`/`-`.
type Operand = { value: number; percent: boolean };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === " ") { i++; continue; }
    if (ch === "+") { tokens.push({ type: "PLUS", value: "+" }); i++; continue; }
    if (ch === "-") { tokens.push({ type: "MINUS", value: "-" }); i++; continue; }
    if (ch === "*") { tokens.push({ type: "STAR", value: "*" }); i++; continue; }
    if (ch === "/") { tokens.push({ type: "SLASH", value: "/" }); i++; continue; }
    if (ch === "%") { tokens.push({ type: "PERCENT", value: "%" }); i++; continue; }
    if (ch === "(") { tokens.push({ type: "LPAREN", value: "(" }); i++; continue; }
    if (ch === ")") { tokens.push({ type: "RPAREN", value: ")" }); i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let num = "";
      while (i < input.length && /[0-9.]/.test(input[i])) {
        num += input[i];
        i++;
      }
      // parseFloat silently truncates malformed input ("1.2.3" → 1.2, "." → NaN):
      // reject more than one dot and digit-less numbers here instead.
      const dots = num.split(".").length - 1;
      if (dots > 1 || !/\d/.test(num)) {
        throw new Error(`Nombre invalide: '${num}'`);
      }
      tokens.push({ type: "NUMBER", value: num });
      continue;
    }
    throw new Error(`Caractère invalide: '${ch}'`);
  }
  tokens.push({ type: "EOF", value: "" });
  return tokens;
}

class Parser {
  private pos = 0;
  private tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    const token = this.tokens[this.pos];
    this.pos++;
    return token;
  }

  private expect(type: TokenType): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw new Error(`Syntaxe invalide: attendu ${type}, reçu ${token.type}`);
    }
    return this.advance();
  }

  parse(): number {
    const result = this.parseAddSub();
    if (this.peek().type !== "EOF") {
      throw new Error(`Syntaxe invalide: caractère inattendu '${this.peek().value}'`);
    }
    return result.value;
  }

  private parseAddSub(): Operand {
    let left = this.parseMulDiv();
    while (this.peek().type === "PLUS" || this.peek().type === "MINUS") {
      const op = this.advance();
      const right = this.parseMulDiv();
      // `%` as the direct right operand of +/- is a percentage of the left base:
      // `200 + 10%` → 220, `200 - 10%` → 180, applied left to right.
      const delta = right.percent ? left.value * right.value : right.value;
      left = { value: op.type === "PLUS" ? left.value + delta : left.value - delta, percent: false };
    }
    return left;
  }

  private parseMulDiv(): Operand {
    let left = this.parsePercent();
    while (this.peek().type === "STAR" || this.peek().type === "SLASH") {
      const op = this.advance();
      const right = this.parsePercent();
      if (op.type === "SLASH" && right.value === 0) {
        throw new Error("Division par zéro");
      }
      // A `*` or `/` consumes the percent meaning: `10% * 2` is an ordinary 0.2.
      left = {
        value: op.type === "STAR" ? left.value * right.value : left.value / right.value,
        percent: false,
      };
    }
    return left;
  }

  private parsePercent(): Operand {
    const operand = this.parseUnary();
    if (this.peek().type !== "PERCENT") {
      return operand;
    }
    this.advance();
    if (this.peek().type === "PERCENT") {
      throw new Error("Opérateur '%' répété");
    }
    return { value: operand.value / 100, percent: true };
  }

  private parseUnary(): Operand {
    if (this.peek().type === "MINUS") {
      this.advance();
      const operand = this.parsePrimary();
      return { value: -operand.value, percent: operand.percent };
    }
    if (this.peek().type === "PLUS") {
      this.advance();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Operand {
    if (this.peek().type === "LPAREN") {
      this.advance();
      const result = this.parseAddSub();
      this.expect("RPAREN");
      // Parentheses are transparent: `200 + (10%)` keeps the percent meaning.
      return result;
    }
    if (this.peek().type === "NUMBER") {
      return { value: parseFloat(this.advance().value), percent: false };
    }
    throw new Error(`Syntaxe invalide: attendu un nombre ou '(', reçu '${this.peek().value}'`);
  }
}

/**
 * `%` is a postfix operator. Alone it divides by 100 (`50%` → 0.5, `200 * 10%` → 20).
 * As the direct right operand of a `+`/`-`, it means "percent of the left base":
 * `200 + 10%` → 220, `200 - 10%` → 180, applied left to right so `200 + 10% + 10%` → 242.
 * The percent meaning is transparent through parentheses (`200 + (10%)` → 220) but is
 * consumed by `*`/`/` (`200 + 10% * 2` → 200.2). A repeated `%` is rejected.
 */
export function evaluate(expression: string): number {
  const sanitized = expression.replace(/\s+/g, " ").trim();
  if (!sanitized) {
    throw new Error("Expression vide");
  }
  // tokenize is the single validation point: unknown characters (letters included) are rejected there.
  return new Parser(tokenize(sanitized)).parse();
}
