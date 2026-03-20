import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import type { PluginRuntime } from "./runtime-api.js";

const { setRuntime: setBastionRuntime, getRuntime: getBastionRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Bastion runtime not initialized");
export { getBastionRuntime, setBastionRuntime };
