import {
  DiscordGatewayAdapterCreator,
  joinVoiceChannel,
  VoiceConnection,
} from "@discordjs/voice";
import { VoiceBasedChannel } from "discord.js";

export async function joinChannel(
  channel: VoiceBasedChannel
): Promise<VoiceConnection | null> {
  try {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      selfDeaf: false,
      selfMute: false,
      adapterCreator: channel.guild
        .voiceAdapterCreator as unknown as DiscordGatewayAdapterCreator,
    });
    return connection;
  } catch (error) {
    console.error(error);
    return null;
  }
}