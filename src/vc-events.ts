import {
  entersState,
  getVoiceConnection,
  VoiceConnection,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import config from "config";
import {
  Guild,
  GuildMember,
  Snowflake,
  TextChannel,
  ThreadChannel,
  VoiceBasedChannel,
} from "discord.js";
import fs from "fs";
import { getClient } from "./main";
import { recorder } from "./recorder";
import { getSpeechRecognition } from "./speech-recognition";
import { joinChannel, SILENCE_FRAME } from "./utils";

let recordingUsers: string[] = [];
let sessionThread: ThreadChannel|null = null;
const voiceChannelId: string|null = config.has("voiceChannel") ? config.get("voiceChannel") : null;

async function getUser(userId: Snowflake) {
  const client = getClient();
  if (client.users.cache.get(userId)) {
    return client.users.cache.get(userId);
  }
  return await client.users.fetch(userId);
}

export async function processJoin(connection: VoiceConnection | null) {
  if (connection) {
    const result = connection.playOpusPacket(SILENCE_FRAME);
    console.log("Send silence packet: ", result);

    const startTime = Date.now();
    if (sessionThread) sessionThread.setArchived(true);
    sessionThread = null;

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20e3);
      const receiver = connection.receiver;

      receiver.speaking.on("start", async (userId: string) => {
        if (recordingUsers.includes(userId)) {
          return;
        }
        recordingUsers.push(userId);
        const user = await getUser(userId);
        console.log(`💬 ${user?.tag} starts speaking`);
        const filename = await recorder(receiver, userId, user);
        console.log(
          `⏩ ${user?.tag} ends speaking (and recognizing) -> ${filename}`
        );

        const result = getSpeechRecognition(filename);
        recordingUsers = recordingUsers.filter((id) => id !== userId);
        if (fs.existsSync(filename)) fs.unlinkSync(filename);
        if (!result) {
          console.log(`❌ ${user?.tag} failed recognize speech`);
          return;
        }

        const endTime = Date.now();
        const elapsedTime = new Date(endTime - startTime);
        const elapsedTimeString = elapsedTime.toISOString().substring(11, 19);
        const elapsed = (config.has('enableElapsedTime') && config.get('enableElapsedTime') as boolean)
          ? `\`${elapsedTimeString}\` `
          : '';

        const confidence = Math.floor(result.confidence * 100);
        console.log(
          `✅ ${elapsedTimeString} ${user?.tag} recognized speech: ${result.text} (${confidence}%)`
        );
        const message = `${elapsed}\`${user?.tag}\`: \`${result.text}\` (${confidence}%)`;
        if (config.has("sendChannel")) {
          getClient()
            .channels.fetch(config.get("sendChannel"))
            .then((channel) => {
              if (channel instanceof TextChannel) channel.send(message);
            });
        }

        const inviteThreadOnSpeaking = config.has("inviteThreadOnSpeaking") && config.get("inviteThreadOnSpeaking") as boolean
        if (config.has("threadChannel")) {
          if (sessionThread || config.has("sendThread")) {
            getClient()
              .channels.fetch(config.get("threadChannel"))
              .then(async (channel) => {
                if (!(channel instanceof TextChannel)) return;
                const thread = sessionThread ?? await channel?.threads.fetch(config.get("sendThread"))
                if (!thread) return;
                if (inviteThreadOnSpeaking && sessionThread && user) sessionThread.members.add(user);
                thread?.send(message);
              });
          } else {
            getClient()
            .channels.fetch(config.get("threadChannel"))
            .then(async (channel) => {
              if (channel instanceof TextChannel) {
                const startDate = new Date(startTime).toISOString().replace(/T/, ' ').replace(/\..+/, '');
                const startMessage = `💬 ${startDate}`;
                const channelMessage = await channel.send(startMessage);
                sessionThread = await channelMessage.startThread({
                  name: startMessage.replace(/:/g, '-'),
                  autoArchiveDuration: 60,
                  reason: `💬 ${user?.tag} starts speaking`,
                });
                if (inviteThreadOnSpeaking && user) sessionThread.members.add(user);
                sessionThread.send(message);
              }
            });
          }
        }
      });
    } catch (error) {
      console.warn(error);
    }
  }
}

export async function Join(
  guild: Guild,
  channel: VoiceBasedChannel,
  member: GuildMember
) {
  console.log(
    `Member ${member.user.tag} Join to ${channel.name} in ${guild.name}`
  );
  const joiningChannel = getVoiceConnection(guild.id);
  let connection: VoiceConnection | null = null;
  if (!joiningChannel) {
    // 固定チャンネルID が有効
    if (voiceChannelId) {
      // 固定チャンネル以外なら何もしない
      if (voiceChannelId !== channel.id)
        return;
    }  
    // どこにも参加していないので参加する
    connection = await joinChannel(channel);
  } else if (joiningChannel.joinConfig.channelId == channel.id) {
    // 同じチャンネルに参加しているので何もしない
    return;
  } else {
    // それ以外(他のチャンネルに参加している)のときは、何もしない
    return;
  }
  await processJoin(connection);
}

export async function Leave(
  guild: Guild,
  channel: VoiceBasedChannel,
  member: GuildMember
) {
  console.log(
    `Member ${member.user.tag} Leaved from ${channel.name} in ${guild.name}`
  );
  const count = channel.members.filter(
    (u) => u.id != getClient().user?.id && !u.user.bot
  ).size;

  if (member.id == getClient().user?.id) {
    if (count != 0) {
      console.log("🤖 Reconnecting...");
      const connection = await joinChannel(channel);
      await processJoin(connection);
    }
  } else {
    if (count == 0) {
      console.log("🤖 Disconnect");
      const connection = getVoiceConnection(guild.id);
      if (connection) {
        connection.disconnect();
      }
      if (sessionThread) sessionThread.setArchived(true);
      sessionThread = null;  
    }
  }
}
