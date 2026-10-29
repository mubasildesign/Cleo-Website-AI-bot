import { knowledge } from "./lib/handlers.js";

export default function handler(req, res) {
  return knowledge(req, res);
}
