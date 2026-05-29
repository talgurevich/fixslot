import { MessagingProvider } from "./MessagingProvider";

// Real WhatsApp transport via Green API (spec §2). Only used when
// MESSAGING_PROVIDER=greenapi and credentials are supplied via env vars.
// Never exercised by the test suite (spec §9).
export class GreenApiProvider implements MessagingProvider {
  constructor(
    private readonly instance: string,
    private readonly token: string,
  ) {
    if (!instance || !token) {
      throw new Error(
        "GreenApiProvider requires GREEN_API_INSTANCE and GREEN_API_TOKEN env vars.",
      );
    }
  }

  async sendMessage(toPhone: string, text: string): Promise<void> {
    const url = `https://api.green-api.com/waInstance${this.instance}/sendMessage/${this.token}`;
    const body = JSON.stringify({ chatId: toChatId(toPhone), message: text });

    // Send and retry once on failure (spec §8).
    try {
      await this.post(url, body);
    } catch (err) {
      console.error("Green API send failed, retrying once:", err);
      await this.post(url, body);
    }
  }

  private async post(url: string, body: string): Promise<void> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) {
      throw new Error(`Green API responded ${res.status}: ${await res.text()}`);
    }
  }
}

// Green API addresses individual chats as "<digits>@c.us".
function toChatId(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `${digits}@c.us`;
}
