import { ChannelRuntime, NewMessage } from "./types.js";
import { getNewMessages, getMessagesSince } from "./db.js";
import { TIMEZONE, MESSAGE_POLL_INTERVAL } from "./config.js";
import { GroupQueue } from "./group.js";
import { logger } from "./logger.js";

let messageLoopRunning = false;
export async function startMessageLoop(
  runtime: ChannelRuntime,
  queue: GroupQueue,
): Promise<void> {
  if (messageLoopRunning) {
    logger.debug("Message loop already running, skipping duplicate start");
    return;
  }
  messageLoopRunning = true;

  const jids: string[] = [];
  for (const ch of runtime.channels) {
    jids.push(ch.jid);
  }

  logger.info(`VT-Claw running...`);
  while (true) {
    try {
      const { messages, newTimestamp } = getNewMessages(
        jids,
        runtime.lastTimestamp,
      );

      if (messages.length > 0) {
        logger.info({ count: messages.length }, "New messages");

        // Advance the "seen" cursor for all messages immediately
        runtime.lastTimestamp = newTimestamp;
        runtime.saveState();

        // Deduplicate by group
        const messagesByGroup = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const existing = messagesByGroup.get(msg.jid);
          if (existing) {
            existing.push(msg);
          } else {
            messagesByGroup.set(msg.jid, [msg]);
          }
        }

        for (const [chatJid, groupMessages] of messagesByGroup) {
          const channel = runtime.findChannel(chatJid);
          if (!channel) {
            logger.warn({ chatJid }, "No channel owns JID, skipping messages");
            continue;
          }

          const allPending = getMessagesSince(
            chatJid,
            runtime.lastAgentTimestamp[chatJid] || "",
          );
          const messagesToSend =
            allPending.length > 0 ? allPending : groupMessages;
          const formatted = formatMessages(messagesToSend, TIMEZONE);

          if (queue.sendMessage(chatJid, formatted)) {
            logger.debug(
              { chatJid, count: messagesToSend.length },
              "Piped messages to active container",
            );
            runtime.lastAgentTimestamp[chatJid] =
              messagesToSend[messagesToSend.length - 1].timestamp;
            runtime.saveState();
            // Show typing indicator while the container processes the piped message
            channel.setTyping?.(true);
          } else {
            // No active container — enqueue for a new one
            queue.enqueueMessageCheck(chatJid);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, "Error in message loop");
    }
    await new Promise((resolve) => setTimeout(resolve, MESSAGE_POLL_INTERVAL));
  }
}

// helper function for messsage loop and group queue
function formatLocalTime(utcIso: string, timezone: string): string {
  //Convert a UTC ISO timestamp to a localized display string.
  //Uses the Intl API (no external dependencies).
  const date = new Date(utcIso);
  return date.toLocaleString("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
function escapeXml(s: string): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
export function formatMessages(
  messages: NewMessage[],
  timezone: string,
): string {
  const lines = messages.map((m) => {
    const displayTime = formatLocalTime(m.timestamp, timezone);
    return `<message time="${escapeXml(displayTime)}" type='${m.type}'>${escapeXml(m.content)}</message>`;
  });
  const header = `<context timezone="${escapeXml(timezone)}" />\n`;
  return `${header}<messages>\n${lines.join("\n")}\n</messages>`;
}

export function stripInternalTags(text: string): string {
  return text.replace(/<internal>[\s\S]*?<\/internal>/g, "").trim();
}

export function formatOutbound(rawText: string): string {
  const text = stripInternalTags(rawText);
  if (!text) return "";
  return text;
}
