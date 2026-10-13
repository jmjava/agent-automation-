import { describe, it, expect } from "vitest";
import { add, subtract, multiply, divide, factorial } from "./math.js";

describe("math", () => {
  it("adds", () => expect(add(2, 3)).toBe(5));
  it("subtracts", () => expect(subtract(5, 3)).toBe(2));
  it("multiplies", () => expect(multiply(4, 5)).toBe(20));
  it("divides", () => expect(divide(10, 2)).toBe(5));
  it("divide by zero throws", () => expect(() => divide(1, 0)).toThrow());
  it("factorial of 5", () => expect(factorial(5)).toBe(120));
  it("factorial of 0", () => expect(factorial(0)).toBe(1));
  it("factorial of negative throws", () => expect(() => factorial(-1)).toThrow());
});
