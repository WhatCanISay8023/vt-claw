import crypto from "node:crypto";
import { logger } from "../logger.js";
import { NewMessage, Channel, ChannelOpts } from "../types.js";
import {
  WeChatAuthInfo,
  wechat_login,
  apiGet,
  apiPost,
  WECHAT_BASE_URL,
} from "./login.js";

interface WxMessage {
  msgId: string;
  chatId: string;
  senderId: string;
  senderName?: string;
  content: string;
  timestamp: string;
  isGroup?: boolean;
}

/** X-WECHAT-UIN: 随机 uint32 → 十进制字符串 → base64 */
function randomWechatUin() {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

/** 从消息 item_list 提取纯文本 */
function extractText(msg: any) {
  for (const item of msg.item_list ?? []) {
    if (item.type === 1 && item.text_item?.text) return item.text_item.text;
    if (item.type === 3 && item.voice_item?.text)
      return `[语音] ${item.voice_item.text}`;
    if (item.type === 2) return "[图片]";
    if (item.type === 4) return `[文件] ${item.file_item?.file_name ?? ""}`;
    if (item.type === 5) return "[视频]";
  }
  return "[空消息]";
}

/** 发送文本消息 */
async function sendMessage(
  baseUrl: string,
  token: string,
  toUserId: string,
  text: string,
  contextToken: any,
) {
  const clientId = `demo-${crypto.randomUUID()}`;
  await apiPost(
    baseUrl,
    "ilink/bot/sendmessage",
    {
      msg: {
        from_user_id: "",
        to_user_id: toUserId,
        client_id: clientId,
        message_type: 2, // BOT
        message_state: 2, // FINISH
        context_token: contextToken,
        item_list: [
          { type: 1, text_item: { text } }, // TEXT
        ],
      },
    },
    token,
  );
  return clientId;
}

export class WeChatChannel implements Channel {
  name = "";
  jid = "";
  folder = "";
  private connected = false;
  private auth: WeChatAuthInfo;
  private opts: ChannelOpts;
  private typing_ticket: string = "";
  private lastContentToken: string = "";

  private constructor(auth: WeChatAuthInfo, opts: ChannelOpts) {
    this.auth = {
      WX_TOKEN: auth.WX_TOKEN,
      WX_ACCOUNT_ID: auth.WX_ACCOUNT_ID,
      WX_USER_ID: auth.WX_USER_ID,
    };
    this.name = `WeChat-${auth.WX_USER_ID}`.slice(0, 15);
    this.jid = `wx-${auth.WX_USER_ID}`;
    this.folder = "wx-" + auth.WX_ACCOUNT_ID.split("@")[0];
    this.opts = opts;
  }

  static async create(opts: ChannelOpts): Promise<WeChatChannel> {
    const auth = await wechat_login();
    const channel = new WeChatChannel(auth, opts);
    return channel;
  }

  async connect(): Promise<void> {
    try {
      this.connected = true;
      void this.pollMessagesLoop();

      logger.info("WeChat channel connected");
    } catch (err) {
      logger.error({ err }, "Failed to connect WeChat channel");
      throw err;
    }
  }
  async disconnect(): Promise<void> {
    this.connected = false;
    logger.info("WeChat channel disconnected");
  }
  isConnected(): boolean {
    return this.connected;
  }

  async sendMessage(
    type: "text" | "image" | "file",
    content: string,
  ): Promise<void> {
    if (!this.connected || !this.auth.WX_TOKEN) {
      logger.warn("WeChat channel not connected, cannot send message");
      return;
    }
    const userId = this.auth.WX_USER_ID;
    await sendMessage(
      WECHAT_BASE_URL,
      this.auth.WX_TOKEN,
      userId,
      content,
      this.lastContentToken,
    );
    logger.debug({ userId }, "WeChat message sent");
  }

  async setTyping(isTyping: boolean): Promise<void> {
    /*
    if (this.typing_ticket === "") {
      const resp = await apiPost(
        WECHAT_BASE_URL,
        "/ilink/bot/getconfig",
        {},
        this.auth.WX_TOKEN,
        38_000, // 长轮询，服务器最多 hold 35s
      );
      console.log(">>>>>>>>>: " + resp);
    }
    */
  }

  // internal functions

  /** 长轮询获取新消息，返回 { msgs, get_updates_buf } */
  private async getUpdates(getUpdatesBuf: any) {
    const resp = await apiPost(
      WECHAT_BASE_URL,
      "ilink/bot/getupdates",
      { get_updates_buf: getUpdatesBuf ?? "" },
      this.auth.WX_TOKEN,
      38_000, // 长轮询，服务器最多 hold 35s
    );
    return resp ?? { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf };
  }

  /**
   * 处理接收到的消息
   */
  private async handleMessage(userId: string, text: string): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const newMsg: NewMessage = {
        id: crypto.randomUUID(),
        jid: this.jid,
        role: "me",
        type: "text",
        content: text,
        timestamp: timestamp,
      };

      this.opts.onMessage(this.jid, newMsg);
      logger.info({ userId }, "WeChat message received");
    } catch (err) {
      logger.error({ userId }, "Error handling WeChat message");
    }
  }

  private async pollMessagesLoop(): Promise<void> {
    if (!this.connected || !this.auth.WX_TOKEN) return;
    logger.info("🚀 开始微信长轮询收消息...\n");

    let getUpdatesBuf: any = "";
    while (this.connected) {
      try {
        const resp = await this.getUpdates(getUpdatesBuf);
        // 更新 buf（服务器下发的游标，下次请求带上）
        if (resp.get_updates_buf) {
          getUpdatesBuf = resp.get_updates_buf;
        }

        for (const msg of resp.msgs ?? []) {
          // 只处理用户发来的消息（message_type=1）
          if (msg.message_type !== 1) continue;

          const from = msg.from_user_id;
          const text = extractText(msg);
          this.lastContentToken = msg.context_token;

          logger.info(`📩 [${new Date().toLocaleTimeString()}] 收到消息`);
          logger.info(`   From: ${from}`);
          logger.info(`   Text: ${text}`);

          await this.handleMessage(from, text);
        }
      } catch (err: any) {
        if (
          err.message?.includes("session timeout") ||
          err.message?.includes("-14")
        ) {
          console.error("❌ Session 已过期，请重新登录: node demo.mjs --login");
          process.exit(1);
        }
        console.error(`⚠️  轮询出错: ${err.message}，3 秒后重试...`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
}
