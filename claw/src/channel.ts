import type { ChannelRuntime, Channel, ChannelOpts } from "./types.js";
import { isValidGroupFolder } from "./group.js";
import { WeChatChannel } from "./wechat/index.js";
import { createTask, getAllTasks } from "./db.js";

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
  if(true) {
      const ch = await WeChatChannel.create(opts);
      addNew(runtime, ch);
      const tasks = getAllTasks();
      
      let qqfixed = false;
      for (const t of tasks) {
        if (t.id.startsWith("qqfixed-") ) {
          qqfixed = true;
          break;
        }
      }
      if (!qqfixed) {
        // 创建心跳提醒任务，确保 Bot 保持在线
        const intervalMs = 8 * 60 * 60 * 1000; // 8小时
        const now = new Date();
        const nextRun = new Date(now.getTime() + intervalMs);
        createTask({
          id: `qqfixed-${Date.now()}`,
          group_folder: ch.folder,
          jid: ch.jid,
          prompt: "请给我打一个招呼，如果24小时不打招呼，Bot 可能会无法上线！",
          schedule_type: "interval",
          schedule_value: String(intervalMs),
          next_run: nextRun.toISOString(),
          status: "active",
          created_at: now.toISOString(),
        });
      }  
    }


}
