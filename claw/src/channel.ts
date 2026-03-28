import type { ChannelRuntime, Channel, ChannelOpts } from "./types.js";
import { isValidGroupFolder } from "./group.js";
import { WeChatChannel } from "./wechat/index.js";

function addNew(runtime: ChannelRuntime, newCh: Channel) {
  for (const ch of runtime.channels) {
    if (ch.name === newCh.name) {
      throw new Error("Duplated channel's name");
    }
    if (ch.jid === newCh.jid) {
      throw new Error("Duplated channel's jid");
    }
    if (ch.folder === newCh.folder) {
      throw new Error("Duplated channel's folder");
    }
    if (!isValidGroupFolder(ch.folder)) {
      throw new Error(`folder: "${ch.folder}" is invalid!`);
    }
  }
  runtime.channels.push(newCh);
}

export async function connectChannels(runtime: ChannelRuntime): Promise<void> {
  for (const ch of runtime.channels) {
    await ch.connect();
  }
}

export async function buildChannels(
  runtime: ChannelRuntime,
  opts: ChannelOpts,
): Promise<void> {
  // Added WeChat
  {
    const ch = await WeChatChannel.create(opts);
    addNew(runtime, ch);
  }
}
