import { login } from "./lib/handlers.js";

export default function handler(req, res) {
  return login(req, res);
}
