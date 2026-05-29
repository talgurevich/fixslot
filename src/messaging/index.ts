import { env } from "../config";
import { MessagingProvider } from "./MessagingProvider";
import { FakeProvider } from "./FakeProvider";
import { GreenApiProvider } from "./GreenApiProvider";

let provider: MessagingProvider | null = null;

// Returns the process-wide messaging provider chosen by MESSAGING_PROVIDER.
// Defaults to the in-memory FakeProvider so the app runs offline with no secrets.
export function getProvider(): MessagingProvider {
  if (provider) return provider;
  provider =
    env.messagingProvider === "greenapi"
      ? new GreenApiProvider(env.greenApi.instance, env.greenApi.token)
      : new FakeProvider();
  return provider;
}

export { MessagingProvider } from "./MessagingProvider";
export { FakeProvider } from "./FakeProvider";
export { GreenApiProvider } from "./GreenApiProvider";
