import { describe, it, expect } from "vitest";
import { capitalize, truncate, slugify } from "./string-utils.js";

describe("string-utils", () => {
  it("capitalizes first letter", () => expect(capitalize("hello")).toBe("Hello"));
  it("capitalizes empty string", () => expect(capitalize("")).toBe(""));
  it("truncates long strings", () => expect(truncate("hello world", 5)).toBe("he..."));
  it("no truncate if short", () => expect(truncate("hi", 5)).toBe("hi"));
  it("slugifies", () => expect(slugify("Hello World!")).toBe("hello-world"));
  it("slugifies multiple spaces", () => expect(slugify("  foo  bar  ")).toBe("foo-bar"));
});
