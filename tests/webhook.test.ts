import { describe, it, expect } from "vitest";
import { normalizeGreenApiWebhook } from "../src/webhook";

describe("normalizeGreenApiWebhook", () => {
  it("extracts phone, text, and name from a text message", () => {
    const result = normalizeGreenApiWebhook({
      typeWebhook: "incomingMessageReceived",
      senderData: { chatId: "972501234567@c.us", senderName: "Dana" },
      messageData: { typeMessage: "textMessage", textMessageData: { textMessage: "hi" } },
    });
    expect(result).toEqual({ phone: "972501234567", text: "hi", name: "Dana" });
  });

  it("handles extended text messages", () => {
    const result = normalizeGreenApiWebhook({
      typeWebhook: "incomingMessageReceived",
      senderData: { chatId: "972501234567@c.us" },
      messageData: { typeMessage: "extendedTextMessage", extendedTextMessageData: { text: "2" } },
    });
    expect(result?.text).toBe("2");
  });

  it("returns empty text for non-text messages (caller nudges to reply)", () => {
    const result = normalizeGreenApiWebhook({
      typeWebhook: "incomingMessageReceived",
      senderData: { chatId: "972501234567@c.us" },
      messageData: { typeMessage: "imageMessage" },
    });
    expect(result).toEqual({ phone: "972501234567", text: "", name: "972501234567" });
  });

  it("ignores non-message webhooks", () => {
    expect(normalizeGreenApiWebhook({ typeWebhook: "outgoingMessageStatus" })).toBeNull();
    expect(normalizeGreenApiWebhook(null)).toBeNull();
  });
});
