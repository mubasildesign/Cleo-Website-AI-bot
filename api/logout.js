import { logout } from "./lib/handlers.js";

export default function handler(req, res) {
  return logout(req, res);
}
