export interface NewMessage {
  id: string;
  jid: string;
  role: "bot" | "me";
  type: "text" | "image" | "file";
  content: string;
  timestamp: string;
}

// name: for display
// jid: for key
// folder: for file IPC
export interface Channel {
  name: string;
  jid: string;
  folder: string;

  connect(): Promise<void>;
  sendMessage(type: "text" | "image" | "file", content: string): Promise<void>;
  isConnected(): boolean;
  disconnect(): Promise<void>;
  setTyping?(isTyping: boolean): Promise<void>;
}

export interface ChannelOpts {
  // Callback type that channels use to deliver inbound messages
  onMessage: (jid: string, message: NewMessage) => void;
}

export interface ChannelRuntime {
  lastTimestamp: string;
  lastAgentTimestamp: Record<string, string>;
  sessionIDs: Record<string, string>;
  channels: Channel[];
  loadState(): void;
  saveState(): void;
  findChannel(jid: string): Channel | null;
  findChannelByFolder(folder: string): Channel | null;
}

export interface ScheduledTask {
  id: string;
  jid: string;
  group_folder: string;
  prompt: string;
  schedule_type: "cron" | "interval" | "once";
  schedule_value: string;
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: "active" | "paused" | "completed";
  created_at: string;
}
