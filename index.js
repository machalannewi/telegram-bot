const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const express = require("express");
const fs = require("fs").promises;
const path = require("path");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// ANSI color codes for terminal styling
const colors = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
  bright: "\x1b[1m",
};

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    status: "User client is running",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.listen(port, () => {
  console.log(`Web server running on port ${port}`);
});

// Keep-alive function
function keepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;

  setInterval(() => {
    fetch(url)
      .then((response) => {
        console.log(`Keep-alive ping successful: ${response.status}`);
      })
      .catch((err) => {
        console.log("Keep-alive ping failed:", err.message);
      });
  }, 14 * 60 * 1000); // 14 minutes
}

// File to store monitored groups
const DATA_FILE = path.join(__dirname, "monitored_groups.json");
let monitoredGroups = new Set();

// Load monitored groups from file
async function loadMonitoredGroups() {
  try {
    const data = await fs.readFile(DATA_FILE, "utf8");
    const groups = JSON.parse(data);
    monitoredGroups = new Set(groups);
    console.log(`Loaded ${monitoredGroups.size} monitored groups from file`);
  } catch (error) {
    if (error.code === "ENOENT") {
      monitoredGroups = new Set();
      await saveMonitoredGroups();
      console.log("Created new monitored groups file");
    } else {
      console.error("Error loading monitored groups:", error);
    }
  }
}

// Save monitored groups to file
async function saveMonitoredGroups() {
  try {
    const groupsArray = Array.from(monitoredGroups);
    await fs.writeFile(DATA_FILE, JSON.stringify(groupsArray, null, 2));
  } catch (error) {
    console.error("Error saving monitored groups:", error);
  }
}

// Store group names for reference
const groupNames = new Map();

// Initialize Telegram client with your account
const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const stringSession = new StringSession(process.env.SESSION_STRING || "");

const client = new TelegramClient(stringSession, apiId, apiHash, {
  connectionRetries: 5,
});

// Add all groups to monitoring
async function addAllGroupsToMonitoring() {
  console.log("🔍 Adding all groups to monitoring...");

  try {
    const dialogs = await client.getDialogs({ limit: 500 });

    // Clear existing monitoring list
    monitoredGroups.clear();
    groupNames.clear();

    let processedCount = 0;
    for (const dialog of dialogs) {
      const entity = dialog.entity;

      // Check if it's a group or supergroup (Channel with megagroup = true)
      if (entity.className === "Channel" && entity.megagroup) {
        // Supergroups: use negative ID with -100 prefix
        const groupId = `-100${entity.id}`;
        const groupTitle = entity.title;

        monitoredGroups.add(groupId);
        monitoredGroups.add(entity.id.toString()); // Also store without prefix
        groupNames.set(groupId, groupTitle);
        groupNames.set(entity.id.toString(), groupTitle);

        console.log(`✅ Added: ${groupTitle} (ID: ${groupId})`);
        processedCount++;

        await new Promise((resolve) => setTimeout(resolve, 100));
      } else if (entity.className === "Chat") {
        // Regular groups: use negative ID
        const groupId = `-${entity.id}`;
        const groupTitle = entity.title;

        monitoredGroups.add(groupId);
        monitoredGroups.add(entity.id.toString()); // Also store without prefix
        groupNames.set(groupId, groupTitle);
        groupNames.set(entity.id.toString(), groupTitle);

        console.log(`✅ Added: ${groupTitle} (ID: ${groupId})`);
        processedCount++;

        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    await saveMonitoredGroups();
    console.log(`🎯 Setup complete! Monitoring ${monitoredGroups.size} groups`);
  } catch (error) {
    console.error("Error adding groups to monitoring:", error);
  }
}

// Start the client
(async () => {
  console.log("Starting Telegram user client...");

  // Check if session string exists
  if (!stringSession.sessionString) {
    console.error("❌ ERROR: SESSION_STRING is missing in .env file!");
    console.log("\n📝 To get your session string:");
    console.log("1. Run this locally ONCE with the login-telegram.js script");
    console.log("2. Copy the SESSION_STRING it generates");
    console.log("3. Add it to your .env file on Render\n");
    process.exit(1);
  }

  try {
    await client.connect();
    console.log(
      `${colors.green}Logged in as ${colors.bright}${
        (await client.getMe()).firstName
      }${colors.reset}`
    );
  } catch (error) {
    console.error("❌ Failed to connect:", error.message);
    console.log("\n⚠️  Your SESSION_STRING may be invalid or expired.");
    console.log("Run login-telegram.js locally to generate a new one.\n");
    process.exit(1);
  }

  await loadMonitoredGroups();

  // Wait for Telegram to sync
  console.log("Waiting 5 seconds for Telegram to sync...");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Add all groups to monitoring
  await addAllGroupsToMonitoring();

  // Start keep-alive
  console.log("Starting keep-alive service...");
  keepAlive();

  console.log("\n✅ Bot is now running and monitoring for new members!\n");
  console.log(
    "💡 When users join monitored groups, you'll get notifications in Saved Messages\n"
  );
})();

// Listen for ALL messages to catch service messages about new members
client.addEventHandler(async (event) => {
  const message = event.message;

  // Log all service messages for debugging
  if (message.action) {
    console.log(`📢 Service message detected: ${message.action.className}`);
  }

  // Check if this is a service message about new members
  if (!message.action) return;

  // Get chat ID from different possible locations and try multiple formats
  let chatIds = [];

  if (message.peerId?.channelId) {
    const rawId = message.peerId.channelId.toString();
    chatIds.push(rawId);
    chatIds.push(`-100${rawId}`);
  } else if (message.peerId?.chatId) {
    const rawId = message.peerId.chatId.toString();
    chatIds.push(rawId);
    chatIds.push(`-${rawId}`);
  } else if (message.chatId) {
    const rawId = message.chatId.toString();
    chatIds.push(rawId);
    chatIds.push(`-${rawId}`);
    chatIds.push(`-100${rawId}`);
  }

  console.log(`🔍 Checking chat IDs: ${chatIds.join(", ")}`);

  // Check if we're monitoring any version of this chat ID
  const matchedChatId = chatIds.find((id) => monitoredGroups.has(id));

  if (!matchedChatId) {
    console.log(
      `⚠️  Not monitoring this group (tried IDs: ${chatIds.join(", ")})`
    );
    console.log(
      `📋 Monitored groups: ${Array.from(monitoredGroups)
        .slice(0, 5)
        .join(", ")}...`
    );
    return;
  }

  console.log(`✅ Found monitored group with ID: ${matchedChatId}`);

  // Handle new members joining
  if (message.action.className === "MessageActionChatAddUser") {
    console.log("👥 MessageActionChatAddUser detected!");

    try {
      // Get users who joined
      const newUserIds = message.action.users || [];
      console.log(`📝 Number of new users: ${newUserIds.length}`);

      for (const userId of newUserIds) {
        if (!userId) continue;

        console.log(`⏳ Processing new user ID: ${userId}`);

        // Get the new user info
        const user = await client.getEntity(userId);

        const username = user.username || user.firstName || "Unknown";
        const fullName = [user.firstName, user.lastName]
          .filter(Boolean)
          .join(" ");

        // Get group info - try to get it from the stored name first
        let groupName = groupNames.get(matchedChatId) || "Unknown Group";

        try {
          const chat = await client.getEntity(parseInt(chatIds[0]));
          groupName = chat.title || groupName;
        } catch (e) {
          console.log("Could not fetch group name, using stored name");
        }

        // Get current date and time
        const now = new Date();
        const date = now.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
          timeZone: "Africa/Lagos",
        });
        const time = now.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZone: "Africa/Lagos",
        });

        // Send message to saved messages (yourself)
        const notifMessage =
          `🎉 **New Member Joined!**\n\n` +
          `📆 **Date:** ${date}\n` +
          `🕐 **Time:** ${time}\n` +
          `👤 **Username:** @${username}\n` +
          `📝 **Full Name:** ${fullName}\n` +
          `🆔 **User ID:** \`${userId}\`\n` +
          `🏠 **Group:** ${groupName}`;

        await client.sendMessage("me", { message: notifMessage });

        console.log(
          `${colors.green}✅ Notified about new member: ${username} in ${groupName}${colors.reset}`
        );
      }
    } catch (error) {
      console.error(
        `${colors.yellow}❌ Error processing new member:${colors.reset}`,
        error
      );
    }
  } else if (message.action.className === "MessageActionChatJoinedByLink") {
    console.log("🔗 MessageActionChatJoinedByLink detected!");

    try {
      // User joined via invite link
      const userId = message.fromId?.userId;
      if (!userId) {
        console.log("⚠️  No user ID found in join event");
        return;
      }

      console.log(`⏳ Processing new user (via link) ID: ${userId}`);

      const user = await client.getEntity(userId);
      const username = user.username || user.firstName || "Unknown";
      const fullName = [user.firstName, user.lastName]
        .filter(Boolean)
        .join(" ");

      // Get group info
      let groupName = groupNames.get(matchedChatId) || "Unknown Group";

      try {
        const chat = await client.getEntity(parseInt(chatIds[0]));
        groupName = chat.title || groupName;
      } catch (e) {
        console.log("Could not fetch group name, using stored name");
      }

      const now = new Date();
      const date = now.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "Africa/Lagos",
      });
      const time = now.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "Africa/Lagos",
      });

      const notifMessage =
        `🎉 **New Member Joined (via link)!**\n\n` +
        `📆 **Date:** ${date}\n` +
        `🕐 **Time:** ${time}\n` +
        `👤 **Username:** @${username}\n` +
        `📝 **Full Name:** ${fullName}\n` +
        `🆔 **User ID:** \`${userId}\`\n` +
        `🏠 **Group:** ${groupName}`;

      await client.sendMessage("me", { message: notifMessage });

      console.log(
        `${colors.green}✅ Notified about new member (via link): ${username} in ${groupName}${colors.reset}`
      );
    } catch (error) {
      console.error(
        `${colors.yellow}❌ Error processing new member (via link):${colors.reset}`,
        error
      );
    }
  }
}, new NewMessage({}));

// Handle commands sent to yourself (Saved Messages)
client.addEventHandler(async (event) => {
  const message = event.message;

  // Only process messages you send to yourself
  if (!message.isOutgoing) return;

  const text = message.text?.toLowerCase() || "";

  if (text.startsWith("list")) {
    if (monitoredGroups.size === 0) {
      await client.sendMessage("me", {
        message:
          "I'm not monitoring any groups yet. Use 'refresh' to add all groups!",
      });
      return;
    }

    let groupList = "**Monitored Groups:**\n\n";
    for (const groupId of monitoredGroups) {
      const name = groupNames.get(groupId) || "Unknown Group";
      groupList += `• ${name}\n  ID: \`${groupId}\`\n\n`;
    }

    await client.sendMessage("me", { message: groupList });
  }

  if (text.startsWith("refresh")) {
    await client.sendMessage("me", { message: "🔄 Refreshing all groups..." });
    await addAllGroupsToMonitoring();
    await client.sendMessage("me", {
      message: `✅ Complete! Now monitoring ${monitoredGroups.size} groups.`,
    });
  }

  if (text.startsWith("copy")) {
    const args = text.split(" ");
    if (args.length < 3) {
      await client.sendMessage("me", {
        message:
          "Usage: `copy <username> <userId>` - Display formatted user info",
      });
      return;
    }

    const username = args[1];
    const userId = args[2];

    await client.sendMessage("me", {
      message:
        `📋 **User Info:**\n\n` +
        `👤 **Username:** \`${username}\`\n` +
        `🆔 **User ID:** \`${userId}\`\n\n` +
        `💡 *Tap code blocks to copy*`,
    });
  }

  if (text.startsWith("help")) {
    const helpText = `**Available Commands:**

• **list** - Show all groups I'm monitoring
• **refresh** - Refresh and add all groups
• **copy <username> <userId>** - Display formatted user info
• **help** - Show this help message

**Note:** Send these commands to Saved Messages (this chat).
I monitor ALL groups where your account is present!`;

    await client.sendMessage("me", { message: helpText });
  }
}, new NewMessage({ outgoing: true, fromUsers: ["me"] }));

// Handle being added to new groups
client.addEventHandler(async (event) => {
  const message = event.message;
  if (!message.action) return;

  // Check if you were added to a group
  if (message.action.className === "MessageActionChatAddUser") {
    const users = message.action.users || [];
    const me = await client.getMe();

    if (users.includes(me.id)) {
      const chatId =
        message.peerId?.channelId?.toString() ||
        message.peerId?.chatId?.toString();
      if (!chatId) return;

      try {
        const chat = await client.getEntity(parseInt(chatId));
        const groupName = chat.title;

        monitoredGroups.add(chatId);
        groupNames.set(chatId, groupName);
        await saveMonitoredGroups();

        console.log(
          `${colors.green}Added to new group: ${groupName}${colors.reset}`
        );

        await client.sendMessage("me", {
          message: `🤖 You were added to **${groupName}**. Now monitoring it for new members.`,
        });
      } catch (error) {
        console.error("Error handling new group:", error);
      }
    }
  }
}, new NewMessage({}));

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled Rejection:", error);
});
