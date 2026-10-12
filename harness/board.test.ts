import { describe, it, expect } from "vitest";
import { createBoard } from "./board.js";

describe("board (stub)", () => {
  it("throws when called — stub not yet implemented", () => {
    expect(() => createBoard("/tmp/fake-vault")).toThrowError(/stub/i);
  });
});
