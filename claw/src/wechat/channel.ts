import fs from "node:fs";
import { logger } from "../logger.js";
import { ChannelOpts, Channel, NewMessage } from "../types.js";
import { wechat_login, WeChatAuthInfo, WECHAT_AUTH_FILE } from "./login.js";
// https://github.com/abczsl520/weixin-bot-sdk
import { WeixinBot, ParsedMessage } from "weixin-bot-sdk";

export class WeChatChannel implements Channel {
  name = "";
  jid = "";
  folder = "";
  private opts: ChannelOpts;
  private bot: WeixinBot;
  private connected = false;
  private auth: WeChatAuthInfo;
  // Track current conversation context for replies
  private currentContextToken: string | null = null;
  private currentFromUser: string | null = null;

  private constructor(auth: WeChatAuthInfo, opts: ChannelOpts) {
    this.name = `WeChat-${auth.userId}`.slice(0, 15);
    this.jid = `wx-${auth.userId}`;
    this.folder = "wx-" + auth.botId.split("@")[0];
    this.opts = opts;
    this.auth = auth;

    this.bot = new WeixinBot({
      credentialsPath: WECHAT_AUTH_FILE,
    });

    // Set up event handlers
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Handle incoming messages
    this.bot.on("message", (msg: ParsedMessage) => {
      this.handleIncomingMessage(msg);
    });

    // Handle errors
    this.bot.on("error", (err: Error) => {
      logger.error(`[WeChat] Error: ${err.message}`);
    });

    // Handle session expiration
    this.bot.on("session:expired", () => {
      logger.warn(`[WeChat] Session expired`);
      this.connected = false;
    });
  }

  private handleIncomingMessage(msg: ParsedMessage): void {
    // console.log(JSON.stringify(msg, null, 2));
    // Store context for replies
    this.currentFromUser = msg.from;
    if ((msg as any).context_token) {
      this.currentContextToken = (msg as any).context_token;
    }

    // Determine message type and content
    let type: "text" | "image" | "file" = "text";
    let content = "";

    switch (msg.type) {
      case "text":
        type = "text";
        content = msg.text || "";
        break;
      case "image":
        type = "image";
        content = msg.image?.url || "";
        break;
      case "file":
        type = "file";
        content = msg.file?.file_name || "";
        break;
      /*
      case 'video':
        type = "file";
        content = msg.video?.url || "";
        break;
      */
      case "voice":
        type = "text";
        content = msg.text || "[语音消息]";
        break;
      default:
        type = "text";
        content = msg.text || `[${msg.type}消息]`;
    }

    // Create the message object
    const newMessage: NewMessage = {
      id: "" + msg.messageId,
      jid: this.jid,
      role: "bot",
      type,
      content,
      timestamp: new Date().toISOString(),
    };

    // Deliver to the callback
    this.opts.onMessage(this.jid, newMessage);
  }

  static async create(opts: ChannelOpts): Promise<WeChatChannel> {
    const auth = await wechat_login();
    const channel = new WeChatChannel(auth, opts);
    return channel;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      // Start polling for messages
      this.bot.start();
      this.connected = true;
      logger.info(`[WeChat] Channel connected: ${this.name}`);
    } catch (err) {
      logger.error(`[WeChat] Connect failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    this.bot.stop();
    this.connected = false;
    logger.info(`[WeChat] Channel disconnected: ${this.name}`);
  }

  isConnected(): boolean {
    return this.connected;
  }

  async sendMessage(
    type: "text" | "image" | "file",
    content: string,
  ): Promise<void> {
    if (!this.connected || !this.currentFromUser) {
      throw new Error("Not connected or no active conversation");
    }

    try {
      switch (type) {
        case "text": {
          await this.bot.sendText(
            this.currentFromUser,
            content,
            this.currentContextToken || undefined,
          );
          break;
        }
        case "image": {
          // content should be a file path or URL, read and send
          const buffer = fs.readFileSync(content);
          await this.bot.sendImage(this.currentFromUser, buffer);
          break;
        }
        case "file": {
          // content should be a file path
          const buffer = fs.readFileSync(content);
          const filename = content.split("/").pop() || "file";
          await this.bot.sendFile(this.currentFromUser, buffer, filename);
          break;
        }
      }
    } catch (err) {
      logger.error(`[WeChat] Send message failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async setTyping(isTyping: boolean): Promise<void> {
    if (!this.connected || !this.currentFromUser) return;

    if (isTyping) {
      try {
        await this.bot.sendTyping(this.currentFromUser);
      } catch (err) {
        // Typing indicator is optional, don't throw
        logger.debug(`[WeChat] sendTyping failed: ${(err as Error).message}`);
      }
    }
  }
}
