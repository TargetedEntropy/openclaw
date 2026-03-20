import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { bastionPlugin } from "./src/channel.js";
import { setBastionRuntime } from "./src/runtime.js";

export { bastionPlugin } from "./src/channel.js";
export { setBastionRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "bastion",
  name: "Bastion",
  description: "Bastion channel plugin",
  plugin: bastionPlugin as ChannelPlugin,
  setRuntime: setBastionRuntime,
});
