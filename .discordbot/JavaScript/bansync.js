const BOT_TOKEN = 'no'
const CLIENT_ID = '1396676390501224518'
const MAIN_SERVER_ID = '1270341588882559048'
const OWNER_ID = '938303388137971713'

const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, InteractionType, ComponentType } = require('discord.js')
const fs = require('fs')

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildBans]
})

let previousBans = new Set()
const newlyJoinedGuilds = new Set()
const launchTime = Date.now()
let forceSyncFlag = false
let forceSyncServerId = null

let bansData = { totalBans: 374 }
try {
    if (fs.existsSync('bans.json')) {
        bansData = JSON.parse(fs.readFileSync('bans.json', 'utf-8'))
    }
} catch (e) {
    console.error('[INIT] Failed to load bans.json', e)
}

function saveBansData() {
    try {
        fs.writeFileSync('bans.json', JSON.stringify(bansData))
    } catch (e) {
        console.error('[SAVE] Failed to save bans.json', e)
    }
}

async function syncBans(forceAll = false, specificServerId = null) {
    try {
        console.log(`[SYNC] Starting sync (force: ${forceAll}, server: ${specificServerId ?? 'ALL'})`)
        const mainGuild = await client.guilds.fetch(MAIN_SERVER_ID)
        const bans = await mainGuild.bans.fetch()
        const currentBans = new Set(bans.map(b => b.user.id))

        if (previousBans.size === 0) previousBans = currentBans

        const unbannedUsers = [...previousBans].filter(id => !currentBans.has(id))
        const newlyBannedUsers = [...currentBans].filter(id => !previousBans.has(id))

        const guildsToSync = specificServerId
            ? [client.guilds.cache.get(specificServerId)].filter(Boolean)
            : [...client.guilds.cache.values()].filter(guild => guild.id !== MAIN_SERVER_ID)

        if (forceAll) {
            for (const guild of guildsToSync) {
                console.log(`[SYNC] Force syncing ${guild.name} (${guild.id})`)
                for (const [userId, ban] of bans) {
                    try {
                        const userDisplay = `${userId} | ${ban.user.username}`
                        const isBanned = await guild.bans.fetch(userId).catch(() => null)
                        if (isBanned) continue
                        await guild.members.ban(userId, { reason: `Force sync from ${MAIN_SERVER_ID}` }).catch(() => { })
                        console.log(`[SYNC] Banned ${userDisplay} in ${guild.name}`)
                        bansData.totalBans++
                        saveBansData()
                    } catch (e) {
                        console.error(`[SYNC] Error banning ${userId} in ${guild.name}`, e)
                    }
                }
            }
        } else {
            for (const userId of newlyBannedUsers) {
                const ban = bans.get(userId)
                const userDisplay = `${userId} | ${ban?.user.username ?? 'Unknown'}`
                for (const guild of guildsToSync) {
                    try {
                        const isBanned = await guild.bans.fetch(userId).catch(() => null)
                        if (isBanned) continue
                        await guild.members.ban(userId, { reason: `Banned in main ${MAIN_SERVER_ID}` }).catch(() => { })
                        console.log(`[SYNC] Banned ${userDisplay} in ${guild.name}`)
                        bansData.totalBans++
                        saveBansData()
                    } catch (e) {
                        console.error(`[SYNC] Error banning ${userId} in ${guild.name}`, e)
                    }
                }
            }

            for (const userId of unbannedUsers) {
                for (const guild of guildsToSync) {
                    try {
                        const isBanned = await guild.bans.fetch(userId).catch(() => null)
                        if (!isBanned) continue
                        await guild.members.unban(userId, `Unbanned in main ${MAIN_SERVER_ID}`).catch(() => { })
                        console.log(`[SYNC] Unbanned ${userId} in ${guild.name}`)
                    } catch (e) {
                        console.error(`[SYNC] Error unbanning ${userId} in ${guild.name}`, e)
                    }
                }
            }

            if (!specificServerId && newlyJoinedGuilds.size > 0) {
                for (const guildId of newlyJoinedGuilds) {
                    const guild = client.guilds.cache.get(guildId)
                    if (!guild) continue
                    console.log(`[SYNC] Syncing bans in new guild ${guild.name}`)
                    for (const [userId, ban] of bans) {
                        try {
                            const userDisplay = `${userId} | ${ban.user.username}`
                            const isBanned = await guild.bans.fetch(userId).catch(() => null)
                            if (isBanned) continue
                            await guild.members.ban(userId, { reason: `Banned in main ${MAIN_SERVER_ID}` }).catch(() => { })
                            console.log(`[SYNC] Banned ${userDisplay} in ${guild.name}`)
                            bansData.totalBans++
                            saveBansData()
                        } catch (e) {
                            console.error(`[SYNC] Error banning ${userId} in ${guild.name}`, e)
                        }
                    }
                }
                newlyJoinedGuilds.clear()
            }
        }
        previousBans = currentBans
        console.log('[SYNC] Sync completed.')
    } catch (e) {
        console.error('[SYNC] Top-level sync error', e)
    }
}

async function loop() {
    while (true) {
        const start = Date.now()
        const doForce = forceSyncFlag
        const specificId = forceSyncServerId
        forceSyncFlag = false
        forceSyncServerId = null

        await syncBans(doForce, specificId).catch(e => console.error('[LOOP] Sync error', e))

        const elapsed = Date.now() - start
        const wait = Math.max(10000 - elapsed, 0)
        await new Promise(res => setTimeout(res, wait))
    }
}

async function registerCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('status')
            .setDescription('Show bot status')
            .toJSON(),
        new SlashCommandBuilder()
            .setName('force-sync')
            .setDescription('Force sync bans for all or a specific server')
            .addStringOption(option =>
                option.setName('server')
                    .setDescription('Server ID to sync specifically')
                    .setAutocomplete(true)
                    .setRequired(false)
            )
            .toJSON(),
        new SlashCommandBuilder()
            .setName('server')
            .setDescription('View servers the bot is in (paginated, owner only)')
            .toJSON()
    ]

    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN)
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands })
    console.log('[BOT] Commands registered.')
}

client.once(Events.ClientReady, async () => {
    console.log(`[BOT] Logged in as ${client.user.tag}`)
    await registerCommands()
    loop()
})

client.on(Events.GuildCreate, guild => {
    console.log(`[BOT] Joined ${guild.name} (${guild.id})`)
    newlyJoinedGuilds.add(guild.id)
})

client.on(Events.InteractionCreate, async interaction => {
    try {
        if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
            if (interaction.commandName === 'force-sync' && interaction.user.id === OWNER_ID) {
                const choices = client.guilds.cache
                    .filter(g => g.id !== MAIN_SERVER_ID)
                    .map(g => ({ name: `${g.name} (${g.id})`, value: g.id }))
                    .slice(0, 25)
                await interaction.respond(choices)
            }
            return
        }

        if (!interaction.isChatInputCommand()) return

        if (interaction.commandName === 'status') {
            const uptimeSeconds = Math.floor((Date.now() - launchTime) / 1000)
            const uptime = uptimeSeconds < 60 ? `${uptimeSeconds}s` :
                uptimeSeconds < 3600 ? `${Math.floor(uptimeSeconds / 60)}m` :
                `${Math.floor(uptimeSeconds / 3600)}h`
            const ping = client.ws.ping
            const serverCount = client.guilds.cache.size

            const embed = new EmbedBuilder()
                .setTitle('📊 Bot Status')
                .setColor(0x00AE86)
                .addFields(
                    { name: '⚡ Uptime', value: uptime, inline: true },
                    { name: '🔨 Total Users Banned', value: bansData.totalBans.toString(), inline: true },
                    { name: '🏓 Ping Latency', value: `${ping}ms`, inline: true },
                    { name: '🖥️ Servers', value: serverCount.toString(), inline: true }
                )
                .setTimestamp()

            await interaction.reply({ embeds: [embed], ephemeral: true })
        }

        if (interaction.commandName === 'force-sync') {
            if (interaction.user.id !== OWNER_ID) {
                await interaction.reply({ content: '❌ Not authorized.', ephemeral: true })
                return
            }
            const serverId = interaction.options.getString('server')
            forceSyncFlag = true
            forceSyncServerId = serverId ?? null
            await interaction.reply({ content: serverId ? `🔄 Force sync started for server ${serverId}.` : '🔄 Force sync started for all servers.', ephemeral: true })
            console.log(`[FORCE SYNC] Triggered by ${interaction.user.username} (${interaction.user.id}) for ${serverId ?? 'ALL'}`)
        }

        if (interaction.commandName === 'server') {
            if (interaction.user.id !== OWNER_ID) {
                await interaction.reply({ content: '❌ Not authorized.', ephemeral: true })
                return
            }

            let page = 1
            const perPage = 10
            const guildsArray = [...client.guilds.cache.values()].sort((a, b) => a.name.localeCompare(b.name))
            const totalPages = Math.ceil(guildsArray.length / perPage)

            const getPageEmbed = (pageNum) => {
                const start = (pageNum - 1) * perPage
                const end = start + perPage
                const pageGuilds = guildsArray.slice(start, end)
                const description = pageGuilds.map((g, i) =>
                    `\`${start + i + 1}.\` **${g.name}** (${g.id}) - ${g.memberCount} members`
                ).join('\n') || 'No servers on this page.'

                return new EmbedBuilder()
                    .setTitle(`🖥️ Servers (${guildsArray.length} total)`)
                    .setDescription(description)
                    .setFooter({ text: `Page ${pageNum}/${totalPages}` })
                    .setColor(0x00AE86)
            }

            const createRow = (pageNum) => new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('prev').setLabel('⬅️ Previous').setStyle(ButtonStyle.Secondary).setDisabled(pageNum === 1),
                new ButtonBuilder().setCustomId('jump').setLabel('🔢 Jump to Page').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('next').setLabel('➡️ Next').setStyle(ButtonStyle.Secondary).setDisabled(pageNum === totalPages)
            )

            const message = await interaction.reply({ embeds: [getPageEmbed(page)], components: [createRow(page)], ephemeral: true, fetchReply: true })

            const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60_000 })

            collector.on('collect', async i => {
                if (i.user.id !== OWNER_ID) {
                    await i.reply({ content: '❌ Not authorized.', ephemeral: true })
                    return
                }
                if (i.customId === 'prev' && page > 1) page--
                if (i.customId === 'next' && page < totalPages) page++
                if (i.customId === 'jump') {
                    await i.reply({ content: `Please enter the page number (1-${totalPages}):`, ephemeral: true })
                    const msgCollector = i.channel.createMessageCollector({
                        filter: m => m.author.id === OWNER_ID,
                        max: 1,
                        time: 15_000
                    })
                    msgCollector.on('collect', async msg => {
                        const num = parseInt(msg.content)
                        if (!isNaN(num) && num >= 1 && num <= totalPages) {
                            page = num
                            await interaction.editReply({ embeds: [getPageEmbed(page)], components: [createRow(page)] })
                            await msg.delete().catch(() => { })
                        } else {
                            await i.followUp({ content: '❌ Invalid page number.', ephemeral: true })
                        }
                    })
                    return
                }
                await i.update({ embeds: [getPageEmbed(page)], components: [createRow(page)] })
            })
        }
    } catch (e) {
        console.error('[INTERACTION] Handler error', e)
        if (!interaction.replied) {
            await interaction.reply({ content: '❌ An error occurred.', ephemeral: true }).catch(() => { })
        }
    }
})

process.on('unhandledRejection', err => console.error('[PROCESS] Unhandled Rejection:', err))
process.on('uncaughtException', err => console.error('[PROCESS] Uncaught Exception:', err))

client.login(BOT_TOKEN)
