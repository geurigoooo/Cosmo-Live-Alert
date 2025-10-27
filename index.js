const { Client, GatewayIntentBits, PermissionFlagsBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const { Pool, neonConfig } = require('@neondatabase/serverless');
const { drizzle } = require('drizzle-orm/neon-serverless');
const { eq } = require('drizzle-orm');
const ws = require('ws');
const { guildSettings } = require('./shared/schema.js');

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is not set!');
  console.error('Please provision a PostgreSQL database and set the DATABASE_URL secret.');
  process.exit(1);
}

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers
  ]
});

const ROLE_NAME = 'COSMO Live Alerts';
const ANNOUNCEMENT_CHANNEL_NAME = 'cosmo-live-announcements';

const GROUP_MEMBERS = {
  'tripleS': ['Seoyeon', 'Hyerin', 'Jiwoo', 'Chaeyeon', 'Yooyeon', 'Soomin', 'Nakyoung', 'Yubin', 'Kaede', 'Dahyun', 'Kotone', 'Yeonji', 'Nien', 'Sohyun', 'Xinyu', 'Mayu', 'Lynn', 'Joobin', 'Hayeon', 'Shion', 'Chaewon', 'Sullin', 'Seoah', 'Jiyeon'],
  'ARTMS': ['Heejin', 'Haseul', 'Kim Lip', 'Jinsoul', 'Choerry'],
  'idntt': ['Dohun', 'Heeju', 'Taein', 'Jaeyoung', 'Juho', 'Jiwoon', 'Hwanhee']
};

const commands = [
  new SlashCommandBuilder()
    .setName('live-triples')
    .setDescription('Announce that a tripleS member is going live on COSMO')
    .addStringOption(option =>
      option.setName('member')
        .setDescription('Select the member')
        .setRequired(true)
        .addChoices(
          ...GROUP_MEMBERS['tripleS'].map(member => ({ name: member, value: member }))
        ))
    .addStringOption(option =>
      option.setName('message')
        .setDescription('Optional custom message')
        .setRequired(false)),
  
  new SlashCommandBuilder()
    .setName('live-artms')
    .setDescription('Announce that an ARTMS member is going live on COSMO')
    .addStringOption(option =>
      option.setName('member')
        .setDescription('Select the member')
        .setRequired(true)
        .addChoices(
          ...GROUP_MEMBERS['ARTMS'].map(member => ({ name: member, value: member }))
        ))
    .addStringOption(option =>
      option.setName('message')
        .setDescription('Optional custom message')
        .setRequired(false)),
  
  new SlashCommandBuilder()
    .setName('live-idntt')
    .setDescription('Announce that an idntt member is going live on COSMO')
    .addStringOption(option =>
      option.setName('member')
        .setDescription('Select the member')
        .setRequired(true)
        .addChoices(
          ...GROUP_MEMBERS['idntt'].map(member => ({ name: member, value: member }))
        ))
    .addStringOption(option =>
      option.setName('message')
        .setDescription('Optional custom message')
        .setRequired(false)),
  
  new SlashCommandBuilder()
    .setName('join-notifications')
    .setDescription('Get notified when artists go live on COSMO'),
  
  new SlashCommandBuilder()
    .setName('leave-notifications')
    .setDescription('Stop receiving COSMO live notifications'),

  new SlashCommandBuilder()
    .setName('setup-channel')
    .setDescription('Set the current channel for COSMO live announcements')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(command => command.toJSON());

async function getOrCreateRole(guild) {
  let role = guild.roles.cache.find(r => r.name === ROLE_NAME);
  
  if (!role) {
    try {
      role = await guild.roles.create({
        name: ROLE_NAME,
        color: 0xFF1493,
        reason: 'Role for COSMO live notifications',
        mentionable: true
      });
      console.log(`Created role: ${ROLE_NAME}`);
    } catch (error) {
      console.error('Error creating role:', error);
      return null;
    }
  }
  
  return role;
}

async function getAnnouncementChannel(guild) {
  try {
    const [settings] = await db.select().from(guildSettings).where(eq(guildSettings.guildId, guild.id));
    
    if (settings && settings.announcementChannelId) {
      const channel = guild.channels.cache.get(settings.announcementChannelId);
      if (channel) {
        return channel;
      }
    }
  } catch (error) {
    console.error('Error fetching guild settings from database:', error);
  }
  
  let channel = guild.channels.cache.find(ch => ch.name === ANNOUNCEMENT_CHANNEL_NAME);
  
  if (!channel) {
    try {
      channel = await guild.channels.create({
        name: ANNOUNCEMENT_CHANNEL_NAME,
        reason: 'Channel for COSMO live announcements'
      });
      console.log(`Created channel: ${ANNOUNCEMENT_CHANNEL_NAME}`);
    } catch (error) {
      console.error('Error creating channel:', error);
      return null;
    }
  }
  
  return channel;
}

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}!`);
  console.log(`🤖 Bot is ready and serving ${client.guilds.cache.size} server(s)`);
  
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  
  try {
    console.log('🔄 Registering slash commands...');
    
    for (const guild of client.guilds.cache.values()) {
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, guild.id),
        { body: commands }
      );
      console.log(`✅ Registered commands for guild: ${guild.name}`);
    }
    
    console.log('✅ All slash commands registered successfully!');
  } catch (error) {
    console.error('❌ Error registering slash commands:', error);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'live-triples' || commandName === 'live-artms' || commandName === 'live-idntt') {
    const groupMap = {
      'live-triples': 'tripleS',
      'live-artms': 'ARTMS',
      'live-idntt': 'idntt'
    };
    
    const group = groupMap[commandName];
    const member = interaction.options.getString('member');
    const customMessage = interaction.options.getString('message');
    
    const role = await getOrCreateRole(interaction.guild);
    if (!role) {
      return interaction.reply({ content: '❌ Unable to create or find the notification role. Please check bot permissions.', ephemeral: true });
    }

    const channel = await getAnnouncementChannel(interaction.guild);
    if (!channel) {
      return interaction.reply({ content: '❌ Unable to find or create the announcement channel. Please check bot permissions.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setColor(0xFF1493)
      .setTitle('🎤 COSMO LIVE Alert!')
      .setDescription(`**${member}** from **${group}** is now live on COSMO!`)
      .addFields(
        { name: '📱 Platform', value: 'Cosmo : the Gate', inline: true },
        { name: '👥 Group', value: group, inline: true },
        { name: '🎭 Artist', value: member, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'Join now on the COSMO app!' });

    if (customMessage) {
      embed.addFields({ name: '💬 Message', value: customMessage });
    }

    try {
      await channel.send({
        content: `${role}`,
        embeds: [embed]
      });
      
      await interaction.reply({ 
        content: `✅ Live notification sent for **${member}** (${group}) in ${channel}!`, 
        ephemeral: true 
      });
    } catch (error) {
      console.error('Error sending notification:', error);
      await interaction.reply({ 
        content: '❌ Failed to send notification. Please check bot permissions.', 
        ephemeral: true 
      });
    }
  }

  if (commandName === 'join-notifications') {
    const role = await getOrCreateRole(interaction.guild);
    if (!role) {
      return interaction.reply({ content: '❌ Unable to create or find the notification role.', ephemeral: true });
    }

    const member = interaction.member;
    
    if (member.roles.cache.has(role.id)) {
      return interaction.reply({ 
        content: `ℹ️ You already have the ${role.name} role!`, 
        ephemeral: true 
      });
    }

    try {
      await member.roles.add(role);
      await interaction.reply({ 
        content: `✅ You will now be notified when artists go live on COSMO!`, 
        ephemeral: true 
      });
    } catch (error) {
      console.error('Error adding role:', error);
      await interaction.reply({ 
        content: '❌ Failed to add role. Please contact a server admin.', 
        ephemeral: true 
      });
    }
  }

  if (commandName === 'leave-notifications') {
    const role = await getOrCreateRole(interaction.guild);
    if (!role) {
      return interaction.reply({ content: '❌ Unable to find the notification role.', ephemeral: true });
    }

    const member = interaction.member;
    
    if (!member.roles.cache.has(role.id)) {
      return interaction.reply({ 
        content: `ℹ️ You don't have the ${role.name} role!`, 
        ephemeral: true 
      });
    }

    try {
      await member.roles.remove(role);
      await interaction.reply({ 
        content: `✅ You will no longer receive COSMO live notifications.`, 
        ephemeral: true 
      });
    } catch (error) {
      console.error('Error removing role:', error);
      await interaction.reply({ 
        content: '❌ Failed to remove role. Please contact a server admin.', 
        ephemeral: true 
      });
    }
  }

  if (commandName === 'setup-channel') {
    const channel = interaction.channel;
    
    if (!channel.isTextBased()) {
      return interaction.reply({ 
        content: '❌ This command must be used in a text channel.', 
        ephemeral: true 
      });
    }
    
    try {
      await db
        .insert(guildSettings)
        .values({
          guildId: interaction.guild.id,
          announcementChannelId: channel.id
        })
        .onConflictDoUpdate({
          target: guildSettings.guildId,
          set: { announcementChannelId: channel.id }
        });
      
      await interaction.reply({ 
        content: `✅ COSMO live announcements will now be sent to ${channel}!`, 
        ephemeral: true 
      });
      
      console.log(`Announcement channel for ${interaction.guild.name} set to #${channel.name}`);
    } catch (error) {
      console.error('Error saving channel settings:', error);
      await interaction.reply({ 
        content: '❌ Failed to save channel settings. Please try again.', 
        ephemeral: true 
      });
    }
  }
});

client.on('guildCreate', async guild => {
  console.log(`🎉 Joined new server: ${guild.name}`);
  
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  
  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, guild.id),
      { body: commands }
    );
    console.log(`✅ Registered commands for new guild: ${guild.name}`);
  } catch (error) {
    console.error('Error registering commands for new guild:', error);
  }
});

client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error('❌ Failed to login:', error);
  console.error('Please make sure DISCORD_TOKEN is set in your Replit Secrets.');
  process.exit(1);
});
