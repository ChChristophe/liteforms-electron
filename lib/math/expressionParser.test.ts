import { describe, expect, it } from "vitest";
import { evaluate } from "./expressionParser";

describe("expressionParser", () => {
  it("addition simple", () => {
    expect(evaluate("2 + 3")).toBe(5);
  });

  it("soustraction simple", () => {
    expect(evaluate("10 - 4")).toBe(6);
  });

  it("multiplication simple", () => {
    expect(evaluate("6 * 7")).toBe(42);
  });

  it("division simple", () => {
    expect(evaluate("15 / 3")).toBe(5);
  });

  it("nombres décimaux", () => {
    expect(evaluate("1.5 + 2.5")).toBe(4);
    expect(evaluate(".5 + .5")).toBe(1);
    expect(evaluate("1. + 2")).toBe(3);
  });

  it("priorité opérateurs", () => {
    expect(evaluate("2 + 3 * 4")).toBe(14);
    expect(evaluate("3 * 4 + 2")).toBe(14);
  });

  it("parenthèses", () => {
    expect(evaluate("(2 + 3) * 4")).toBe(20);
    expect(evaluate("((1 + 2) * (3 + 4))")).toBe(21);
  });

  it("pourcentage postfixe", () => {
    expect(evaluate("50%")).toBe(0.5);
    expect(evaluate("200 * 10%")).toBe(20);
    expect(evaluate("100%")).toBe(1);
  });

  it("pourcentage de la base (opérande droit de + / -)", () => {
    expect(evaluate("200 + 10%")).toBe(220);
    expect(evaluate("200 - 10%")).toBe(180);
    expect(evaluate("200 + 10% + 10%")).toBe(242);
    expect(evaluate("10% + 200")).toBe(200.1);
    expect(evaluate("200 + (10%)")).toBe(220);
    expect(evaluate("200 + 10% * 2")).toBe(200.2);
    expect(evaluate("200 + -10%")).toBe(180);
    expect(evaluate("200 + 0%")).toBe(200);
    expect(evaluate("200 + 10")).toBe(210);
  });

  it("rejette un pourcent répété", () => {
    expect(() => evaluate("50%%")).toThrow("Opérateur '%' répété");
  });

  it("négatif unaire", () => {
    expect(evaluate("-5 + 3")).toBe(-2);
    expect(evaluate("-(2 + 3)")).toBe(-5);
    expect(evaluate("+5")).toBe(5);
  });

  it("addition multiple", () => {
    expect(evaluate("1 + 2 + 3 + 4")).toBe(10);
  });

  it("expression complexe", () => {
    expect(evaluate("(10 + 5) * 2 - 8 / 4")).toBe(28);
  });

  it("rejette la division par zéro", () => {
    expect(() => evaluate("10 / 0")).toThrow("Division par zéro");
  });

  it("rejette une expression vide", () => {
    expect(() => evaluate("")).toThrow("Expression vide");
    expect(() => evaluate("   ")).toThrow("Expression vide");
  });

  it("rejette les lettres via le tokenizer", () => {
    expect(() => evaluate("abc")).toThrow("Caractère invalide");
    expect(() => evaluate("2x")).toThrow("Caractère invalide");
  });

  it("rejette les caractères interdits via le tokenizer", () => {
    for (const expr of ["1;2", "1`2", "1{2}", "1|2", "1&2", "1$2", "1@2", "1#2"]) {
      expect(() => evaluate(expr)).toThrow("Caractère invalide");
    }
  });

  it("rejette les nombres malformés", () => {
    for (const expr of ["1.2.3", ".", "..", "1..2"]) {
      expect(() => evaluate(expr)).toThrow("Nombre invalide");
    }
  });

  it("rejette une syntaxe incomplète", () => {
    expect(() => evaluate("1 +")).toThrow("Syntaxe invalide");
    expect(() => evaluate("(1 + 2")).toThrow("Syntaxe invalide");
    expect(() => evaluate("* 3")).toThrow("Syntaxe invalide");
  });

  it("gère les espaces multiples", () => {
    expect(evaluate("  2   +   3  ")).toBe(5);
    expect(evaluate("2\t+\t3")).toBe(5);
  });
});
