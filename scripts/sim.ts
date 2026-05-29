import "dotenv/config";

// Dev webhook simulator: POST a fake inbound WhatsApp message to /webhook so the
// conversation flow can be exercised locally with no phone and no credentials.
//   npm run sim "hi"
//   npm run sim "2" 972501112222
async function main() {
  const message = process.argv[2] ?? "hi";
  const phone = process.argv[3] ?? "972500000000";
  const port = Number(process.env.PORT ?? 3000);

  const payload = {
    typeWebhook: "incomingMessageReceived",
    senderData: {
      chatId: `${phone}@c.us`,
      sender: `${phone}@c.us`,
      senderName: "Sim Client",
    },
    messageData: {
      typeMessage: "textMessage",
      textMessageData: { textMessage: message },
    },
  };

  const res = await fetch(`http://localhost:${port}/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  console.log(`POST /webhook → ${res.status}`);
  console.log(`Sent "${message}" from ${phone}.`);
  console.log("The bot's reply is printed in the `npm run dev` server console.");
}

main().catch((err) => {
  console.error("Simulator failed. Is the server running (npm run dev)?");
  console.error(err);
  process.exit(1);
});
