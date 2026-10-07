import { describe, expect, it } from "vitest";
import { parseLiveSolveInputMessage } from "../src/live-solve";

const message = (input: unknown) => JSON.stringify({ applicationId: "app1", userId: "user1", input });

describe("live CAPTCHA window input", () => {
  it("accepts clicks, drags, scrolling, typing and the allowed keys", () => {
    for (const input of [
      { type: "mouse", action: "down", x: 10, y: 20 },
      { type: "mouse", action: "move", x: 15, y: 20 },
      { type: "wheel", x: 1, y: 1, deltaX: 0, deltaY: 120 },
      { type: "text", text: "x7Kq2" },
      { type: "key", key: "Backspace" },
      { type: "key", key: "Tab", shift: true },
    ]) {
      expect(parseLiveSolveInputMessage(message(input))?.input).toEqual(input);
    }
  });

  it("drops anything else", () => {
    expect(parseLiveSolveInputMessage("not json")).toBeNull();
    expect(parseLiveSolveInputMessage(message({ type: "key", key: "F12" }))).toBeNull();
    expect(parseLiveSolveInputMessage(message({ type: "key", key: "Control+a" }))).toBeNull();
    expect(parseLiveSolveInputMessage(message({ type: "mouse", action: "down", x: -5, y: 1 }))).toBeNull();
    expect(parseLiveSolveInputMessage(message({ type: "text", text: "a".repeat(501) }))).toBeNull();
    expect(parseLiveSolveInputMessage(message({ type: "eval", code: "1" }))).toBeNull();
    expect(parseLiveSolveInputMessage(JSON.stringify({ applicationId: 1, userId: "u", input: { type: "text", text: "a" } }))).toBeNull();
  });
});
