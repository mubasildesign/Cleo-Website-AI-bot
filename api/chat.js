import { chat } from "./lib/handlers.js";

export const config = { maxDuration: 60 };

export default function handler(req, res) {
  return chat(req, res);
}
