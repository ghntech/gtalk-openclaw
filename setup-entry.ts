import { defineSetupPluginEntry } from "openclaw/plugin-sdk/core";
import { companyChatPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(companyChatPlugin);
