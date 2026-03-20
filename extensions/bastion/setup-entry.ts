import { defineSetupPluginEntry } from "openclaw/plugin-sdk/core";
import { bastionPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(bastionPlugin);
