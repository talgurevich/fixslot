import { MessagingProvider } from "./MessagingProvider";

export interface SentMessage {
  toPhone: string;
  text: string;
}

// In-memory provider used as the default (offline) transport and in every test.
// Sent messages are recorded for assertions and echoed to the console so the
// dev webhook simulator (npm run sim) shows the bot's replies without a phone.
export class FakeProvider implements MessagingProvider {
  public readonly sent: SentMessage[] = [];

  async sendMessage(toPhone: string, text: string): Promise<void> {
    this.sent.push({ toPhone, text });
    // eslint-disable-next-line no-console
    console.log(`\n[FakeProvider → ${toPhone}]\n${text}\n`);
  }

  // Test helpers.
  last(): SentMessage | undefined {
    return this.sent[this.sent.length - 1];
  }

  clear(): void {
    this.sent.length = 0;
  }
}
