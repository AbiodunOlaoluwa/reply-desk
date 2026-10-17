import { describe, expect, it } from "vitest";
import { isAutoGreeting, isOptOut } from "@/lib/optout";

describe("opt-out", () => {
  it.each(["stop", "STOP", "Please stop messaging me", "unsubscribe", "remove me from your list", "Don't message me again", "opt out"])(
    "treats %j as an opt-out",
    (t) => expect(isOptOut(t)).toBe(true),
  );
  it.each(["Can you stop by our office on Tuesday?", "We could stop over next week", "non-stop busy here", "hi", "how much?"])(
    "does not treat %j as an opt-out",
    (t) => expect(isOptOut(t)).toBe(false),
  );
});

describe("auto-greetings", () => {
  it("spots a business auto-reply", () => {
    expect(isAutoGreeting("Thank you for contacting Brightpath Studio! How may we help you today?")).toBe(true);
  });
  it("leaves a real reply alone", () => {
    expect(isAutoGreeting("Thanks, what does it cost?")).toBe(false);
  });
});
