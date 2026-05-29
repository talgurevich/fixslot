// Abstraction over the WhatsApp transport (spec §3). Booking logic only ever
// talks to this interface, so swapping Green API for the official Meta Cloud API
// later is a one-file change, and tests can use an in-memory fake.
export interface MessagingProvider {
  sendMessage(toPhone: string, text: string): Promise<void>;
}
