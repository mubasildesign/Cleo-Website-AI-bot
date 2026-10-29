import { session } from "./lib/handlers.js";

export default function handler(req, res) {
  return session(req, res);
}
