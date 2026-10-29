import { bootstrap } from "./lib/handlers.js";

export default function handler(req, res) {
  return bootstrap(req, res);
}
