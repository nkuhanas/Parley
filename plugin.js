import { registerParleyTools } from "./src/index.js";

export default {
  id: "parley",
  name: "Parley",
  description: "Board-scoped coordination runtime and tools for OpenClaw agents.",
  register(api) {
    registerParleyTools(api);
  }
};
