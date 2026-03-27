import { defineSetupPluginEntry } from "openclaw/plugin-sdk/core";
import { gtalkPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(gtalkPlugin);
