import { describe, expect, it } from "vitest";
import { parseControlMessage } from "../src/index";

describe("parseControlMessage", () => {
  it("accepts stop and wake messages for a user", () => {
    expect(parseControlMessage(JSON.stringify({ type: "stop", userId: "u1" }))).toEqual({ type: "stop", userId: "u1" });
    expect(parseControlMessage(JSON.stringify({ type: "wake", userId: "u1" }))).toEqual({ type: "wake", userId: "u1" });
  });

  it("ignores malformed or unknown messages", () => {
    expect(parseControlMessage("not json")).toBeNull();
    expect(parseControlMessage(JSON.stringify({ type: "delete", userId: "u1" }))).toBeNull();
    expect(parseControlMessage(JSON.stringify({ type: "stop" }))).toBeNull();
  });
});
