import { describe, expect, it } from "vitest";
import { sign, verify } from "@/lib/signature";

describe("webhook signature", () => {
  const body = JSON.stringify({ id: "msg_1", from: "+15550100101", text: "hi" });
  it("accepts a body signed with the shared secret", () => expect(verify(body, sign(body, "s3cret"), "s3cret")).toBe(true));
  it("rejects a forged signature", () => expect(verify(body, sign(body, "wrong"), "s3cret")).toBe(false));
  it("rejects a body changed after signing", () => expect(verify(body + " ", sign(body, "s3cret"), "s3cret")).toBe(false));
  it("fails closed when no secret is configured", () => expect(verify(body, sign(body, "s3cret"), undefined)).toBe(false));
  it("fails closed when the header is missing", () => expect(verify(body, null, "s3cret")).toBe(false));
});
