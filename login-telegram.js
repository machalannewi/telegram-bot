const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");
require("dotenv").config();

const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const stringSession = new StringSession(""); // Empty session for first login

const client = new TelegramClient(stringSession, apiId, apiHash, {
  connectionRetries: 5,
});

console.log("🔐 Telegram Login Script");
console.log("========================\n");
console.log("This will generate your SESSION_STRING for deployment.\n");

(async () => {
  try {
    await client.start({
      phoneNumber: async () =>
        await input.text(
          "📱 Enter your phone number (with country code, e.g., +234): "
        ),
      password: async () =>
        await input.text("🔒 Enter your 2FA password (if enabled): "),
      phoneCode: async () =>
        await input.text("💬 Enter the verification code sent to Telegram: "),
      onError: (err) => console.log("❌ Error:", err),
    });

    const me = await client.getMe();
    console.log(
      `\n✅ Successfully logged in as: ${me.firstName} ${me.lastName || ""}`
    );

    const sessionString = client.session.save();

    console.log("\n" + "=".repeat(80));
    console.log("📋 COPY THIS SESSION STRING TO YOUR .env FILE:");
    console.log("=".repeat(80));
    console.log(`\nSESSION_STRING=${sessionString}\n`);
    console.log("=".repeat(80));
    console.log("\n⚠️  IMPORTANT:");
    console.log("1. Copy the entire SESSION_STRING line above");
    console.log("2. Add it to your .env file");
    console.log("3. On Render/Railway, add it as an environment variable");
    console.log(
      "4. Keep this string SECRET - it gives full access to your account!\n"
    );

    await client.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Login failed:", error.message);
    process.exit(1);
  }
})();
