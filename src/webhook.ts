import { Router } from "express";
import { getProvider } from "./messaging";
import { handleInbound } from "./conversationEngine";

export interface NormalizedInbound {
  phone: string;
  text: string;
  name: string;
}

// Parse a Green API "incomingMessageReceived" webhook into our normalized shape.
// Returns null for payloads we can't act on. Non-text messages yield an empty
// `text`, which the engine handles as invalid input (a nudge to reply, spec §8).
export function normalizeGreenApiWebhook(body: any): NormalizedInbound | null {
  if (!body || body.typeWebhook !== "incomingMessageReceived") return null;

  const sender = body.senderData ?? {};
  const chatId: string = sender.chatId ?? sender.sender ?? "";
  const phone = chatId.replace(/@c\.us$/, "").replace(/\D/g, "");
  if (!phone) return null;

  const name: string = sender.senderName || phone;
  const md = body.messageData ?? {};
  let text = "";
  if (md.typeMessage === "textMessage") {
    text = md.textMessageData?.textMessage ?? "";
  } else if (md.typeMessage === "extendedTextMessage") {
    text = md.extendedTextMessageData?.text ?? "";
  }

  return { phone, text, name };
}

export const webhookRouter = Router();

webhookRouter.post("/webhook", (req, res) => {
  const inbound = normalizeGreenApiWebhook(req.body);

  // Respond 200 immediately so Green API does not retry, then process (spec §8).
  res.sendStatus(200);
  if (!inbound) return;

  const provider = getProvider();
  void handleInbound(provider, inbound.phone, inbound.text, {
    clientName: inbound.name,
  }).catch((err) => console.error("Inbound processing failed:", err));
});
