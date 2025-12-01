// Discord.js v14+ Bot
// This bot monitors a specific Discord channel and sends Roblox badge reports

import {
  Client, // Main Discord client class
  GatewayIntentBits, // Used to define which events we want to listen to
  Partials, // Used to allow partial objects (like messages not fully cached)
  EmbedBuilder, // Used to create embedded messages
} from 'discord.js';
import fetch from 'node-fetch'; // Used to make HTTP requests to Roblox APIs

// ---------------- CONFIGURATION ----------------

// Bot token for logging into Discord
const DiscordToken = 'token'; 
// Channel ID to watch for badge report requests
const MonitoredChannelId = 'input channel id'; 
// Emoji shown while processing messages
const LoadingEmojiId = 'loading emoji id'; 
// Emoji used for invalid messages
const InvalidEmoji = '❌'; 
// Emoji used for successfully processed messages
const SuccessEmoji = '✅'; 

// ---------------- CHECK TOKEN ----------------
if (!DiscordToken) {
  // If no token is provided, log error and exit
  console.error('[ERR]: Missing DiscordToken. Exiting.');
  process.exit(1);
}

// ---------------- CREATE CLIENT ----------------

// Create a new Discord client instance
const ClientInstance = new Client({
  intents: [
    GatewayIntentBits.Guilds, // Needed to know about guilds (servers)
    GatewayIntentBits.GuildMessages, // Needed to listen to messages in channels
    GatewayIntentBits.MessageContent, // Needed to read message content
    GatewayIntentBits.DirectMessages, // Needed to DM users
  ],
  partials: [
    Partials.Channel, // Needed to handle DM channels that may not be cached
    Partials.Message, // Needed to handle messages that may not be cached
    Partials.Reaction, // Needed to handle reactions that may not be cached
  ],
});

// ---------------- READY EVENT ----------------

// This event triggers once when the bot is fully ready and logged in
ClientInstance.once('ready', async () => {
  console.log(`✅ Logged in as ${ClientInstance.user.tag}`); // Log bot username

  try {
    // Fetch the monitored channel by ID
    console.debug('[DEBUG] Fetching monitored channel...');
    const Channel = await ClientInstance.channels.fetch(MonitoredChannelId);

    // Check if the channel is text-based (can send messages)
    if (!Channel?.isTextBased()) {
      console.debug('[DEBUG] Channel is not text-based. Exiting ready handler.');
      return; // Exit if not a text channel
    }

    // Fetch pinned messages in the channel
    const PinnedMessages = await Channel.messages.fetchPinned();

    // Check if a notice embed with title "Notice!" already exists
    const NoticeExists = PinnedMessages.some(
      (Msg) => Msg.embeds[0]?.title === 'Notice!'
    );

    if (!NoticeExists) {
      // If no notice exists, create a new embed
      console.debug('[DEBUG] No notice found, sending pinned notice...');
      const NoticeEmbed = new EmbedBuilder()
        .setTitle('Notice!') // Embed title
        .setDescription(
          'Please use this format:\n```\nUser: <username or user ID>\nGame: <game ID>\n```\n- Make sure DMs are enabled.'
        ) // Embed description explaining the format
        .setFooter({ text: 'Have a great day!' }) // Footer text
        .setColor(0xff0000); // Red color for visibility

      // Send the embed in the channel
      const SentMessage = await Channel.send({ embeds: [NoticeEmbed] });
      // Try to pin the embed
      await SentMessage.pin().catch((Err) =>
        console.error('[ERR]: Failed to pin notice embed', Err)
      );
      console.debug('[DEBUG] Notice pinned.');
    } else {
      console.debug('[DEBUG] Notice already exists, skipping.');
    }
  } catch (Err) {
    // Catch any error during ready event
    console.error('[ERR]: Error in ready event', Err);
  }
});

// ---------------- MESSAGE CREATE EVENT ----------------

// This event triggers whenever a new message is sent
ClientInstance.on('messageCreate', async (Message) => {
  console.debug(`[DEBUG] New message from ${Message.author.tag}: ${Message.content}`);

  // Ignore messages sent by bots
  if (Message.author.bot) {
    console.debug('[DEBUG] Message from bot, ignoring.');
    return;
  }

  // Ignore messages not in the monitored channel
  if (Message.channelId !== MonitoredChannelId) {
    console.debug('[DEBUG] Message not in monitored channel, ignoring.');
    return;
  }

  // React with loading emoji immediately to show processing
  try {
    console.debug('[DEBUG] Reacting with loading emoji...');
    await Message.react(`<:emoji:${LoadingEmojiId}>`);
  } catch (Err) {
    console.error('[ERR]: Failed to react with loading emoji', Err);
  }

  // ---------------- PARSE MESSAGE ----------------
  // Split the message by new lines, trim whitespace, and remove empty lines
  console.debug('[DEBUG] Parsing message lines...');
  const Lines = Message.content
    .split(/\r?\n/)
    .map((Line) => Line.trim())
    .filter(Boolean);

  // Extract the "User" line
  const UserLineMatch = Lines[0]?.match(/^User\s*:\s*(.+)$/i);
  // Extract the "Game" line
  const GameLineMatch = Lines[1]?.match(/^Game\s*:\s*(.+)$/i);

  // If either line is missing or invalid, handle as invalid message
  if (!UserLineMatch || !GameLineMatch) {
    console.debug('[DEBUG] Invalid message format.');
    return HandleInvalidMessage(Message);
  }

  // Trim extracted user and game values
  const UserInput = UserLineMatch[1].trim();
  const PlaceIdInput = GameLineMatch[1].trim();

  if (!UserInput || !PlaceIdInput) {
    console.debug('[DEBUG] User input or place ID is empty.');
    return HandleInvalidMessage(Message);
  }

  console.debug(`[DEBUG] User input: ${UserInput}, Place ID: ${PlaceIdInput}`);

  // ---------------- RESOLVE ROBLOX USER ----------------
  let RobloxUserId: string | null = null; // Roblox user ID
  let RobloxUsername: string | null = null; // Roblox username
  let RobloxDisplayName: string | null = null; // Roblox display name

  try {
    // Check if input is numeric (UID) or text (username)
    if (/^\d+$/.test(UserInput)) {
      console.debug('[DEBUG] Resolving numeric Roblox UID...');
      const Res = await fetch(`https://users.roblox.com/v1/users/${UserInput}`);
      if (Res.ok) {
        const Data = await Res.json();
        RobloxUserId = String(Data.id);
        RobloxUsername = Data.name;
        RobloxDisplayName = Data.displayName;
        console.debug('[DEBUG] Roblox user resolved:', Data);
      }
    } else {
      console.debug('[DEBUG] Resolving Roblox username...');
      const Res = await fetch('https://users.roblox.com/v1/usernames/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: [UserInput] }),
      });

      if (Res.ok) {
        const Data = (await Res.json()).data?.[0];
        if (Data) {
          RobloxUserId = String(Data.id);
          RobloxUsername = Data.requestedUsername;
          RobloxDisplayName = Data.displayName;
          console.debug('[DEBUG] Roblox username resolved:', Data);
        }
      }
    }
  } catch (Err) {
    console.error('[ERR]: Failed to resolve Roblox user', Err);
  }

  // If user cannot be resolved, mark message invalid
  if (!RobloxUserId) {
    console.debug('[DEBUG] Could not resolve Roblox user, marking invalid.');
    return HandleInvalidMessage(Message);
  }

  // ---------------- CONVERT PLACE → UNIVERSE ----------------
  let UniverseId: string | null = null; // Universe ID for the game
  try {
    console.debug(`[DEBUG] Converting place ${PlaceIdInput} → universe...`);
    const Res = await fetch(
      `https://apis.roblox.com/universes/v1/places/${PlaceIdInput}/universe`
    );
    if (Res.ok) {
      UniverseId = String((await Res.json()).universeId);
      console.debug(`[DEBUG] Universe ID: ${UniverseId}`);
    }
  } catch (Err) {
    console.error('[ERR]: Failed to convert place → universe', Err);
  }

  if (!UniverseId) {
    console.debug('[DEBUG] Universe ID not found, marking invalid.');
    return HandleInvalidMessage(Message);
  }

  // ---------------- FETCH BADGES ----------------
  const UniverseBadges: { Id: number; Name: string }[] = []; // Array to store all badges
  try {
    console.debug('[DEBUG] Fetching universe badges...');
    let NextCursor = ''; // Cursor for pagination
    while (true) {
      const Res = await fetch(
        `https://badges.roblox.com/v1/universes/${UniverseId}/badges?limit=100${
          NextCursor ? `&cursor=${NextCursor}` : ''
        }`
      );

      if (!Res.ok) break;

      const Data = await Res.json();
      if (Array.isArray(Data.data)) {
        // Add badges to the array
        UniverseBadges.push(
          ...Data.data.map((Badge: any) => ({ Id: Badge.id, Name: Badge.name }))
        );
        console.debug(`[DEBUG] Fetched ${Data.data.length} badges.`);
      }

      // If no more pages, break
      if (!Data.nextPageCursor) break;
      NextCursor = Data.nextPageCursor;
    }
    console.debug(`[DEBUG] Total badges fetched: ${UniverseBadges.length}`);
  } catch (Err) {
    console.error('[ERR]: Failed to fetch universe badges', Err);
  }

  // ---------------- CHECK OBTAINED/MISSING BADGES ----------------
  const ObtainedBadges: typeof UniverseBadges = []; // Badges the user has
  const MissingBadges: typeof UniverseBadges = []; // Badges the user does not have
  let BadgeIndex = 0; // Index used for concurrency workers

  // Worker function to check badges
  async function BadgeWorker() {
    while (BadgeIndex < UniverseBadges.length) {
      const I = BadgeIndex++;
      const Badge = UniverseBadges[I];
      try {
        const Url = `https://badges.roblox.com/v1/users/${RobloxUserId}/badges/${Badge.Id}/awarded-date`;
        const Res = await fetch(Url);
        if (Res.status === 200) {
          ObtainedBadges.push(Badge);
          console.debug(`[DEBUG] Badge obtained: ${Badge.Name} (${Badge.Id})`);
        } else {
          MissingBadges.push(Badge);
          console.debug(`[DEBUG] Badge missing: ${Badge.Name} (${Badge.Id})`);
        }
      } catch {
        MissingBadges.push(Badge);
        console.debug(`[DEBUG] Badge fetch error, assuming missing: ${Badge.Name}`);
      }
    }
  }

  // Run 5 concurrent workers to speed up badge checks
  const WorkerCount = 5;
  await Promise.all(Array.from({ length: WorkerCount }, BadgeWorker));

  // ---------------- BUILD REPORT ----------------
  const DiscordTag = `${Message.author.username}#${Message.author.discriminator}`;
  const DiscordId = Message.author.id;
  const ReportFilename = `${Message.author.username}_${DiscordId}.txt`;

  // Create report text
  const ReportContent = [
    '===== Common Info =====',
    '--- Roblox ---',
    `Display Name: ${RobloxDisplayName}`,
    `Username: ${RobloxUsername}`,
    `UID: ${RobloxUserId}`,
    '--- Discord ---',
    `UID: ${DiscordId}`,
    `Username: ${DiscordTag}`,
    '',
    '===== Obtained Badges =====',
    ...(ObtainedBadges.length
      ? ObtainedBadges.map((B) => `- ${B.Name} (${B.Id})`)
      : ['(none)']),
    '',
    '===== Missing Badges =====',
    ...(MissingBadges.length
      ? MissingBadges.map((B) => `- ${B.Name} (${B.Id})`)
      : ['(none)']),
  ].join('\n');

  console.debug('[DEBUG] Report content prepared.');

  // ---------------- SEND REPORT VIA DM ----------------
  let DmSuccessful = false; // Track if DM was successful
  try {
    // Open a DM channel with the user
    const DmChannel = await Message.author.createDM();
    // Send report as text file
    await DmChannel.send({
      content: `Here is your badge report for game ${PlaceIdInput}.`,
      files: [{ attachment: Buffer.from(ReportContent, 'utf8'), name: ReportFilename }],
    });
    DmSuccessful = true;
    console.debug('[DEBUG] DM sent successfully.');
  } catch (Err) {
    console.error('[ERR]: Failed to send DM', Err);
  }

  // React ✅ if DM succeeded
  if (DmSuccessful) {
    try {
      await Message.reactions.cache.get(LoadingEmojiId)?.remove(); // Remove loading emoji
      await Message.react(SuccessEmoji); // React with success emoji
      console.debug('[DEBUG] Reacted with SuccessEmoji.');
    } catch (Err) {
      console.error('[ERR]: Failed to react with SuccessEmoji', Err);
    }
  }
});

// ---------------- HANDLE INVALID MESSAGES ----------------
async function HandleInvalidMessage(Message: any) {
  console.debug('[DEBUG] Handling invalid message...');
  try {
    await Message.reactions.cache.get(LoadingEmojiId)?.remove(); // Remove loading emoji
    await Message.react(InvalidEmoji); // React ❌
  } catch {}
  setTimeout(() => Message.delete().catch(() => {}), 1000); // Delete message after 1s
  console.debug('[DEBUG] Invalid message deleted after 1s.');
}

// ---------------- GLOBAL ERROR HANDLERS ----------------
process.on('unhandledRejection', (Reason) => console.error('[ERR]:', Reason));
process.on('uncaughtException', (Error) => console.error('[ERR]:', Error));

// ---------------- LOGIN ----------------
ClientInstance.login(DiscordToken).catch((Err) =>
  console.error('[ERR]: Failed login', Err)
);
