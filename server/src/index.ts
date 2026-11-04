import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
import { readConfig } from "./config.ts";
import { loadEnvFile } from "./env.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(path.resolve(here, "../../.env"));

const config = readConfig();
const app = createApp(config, { clientDist: path.resolve(here, "../../client/dist") });
app.listen(config.port, "127.0.0.1", () => {
  console.log(`HIOBuy AI demo server http://127.0.0.1:${config.port}`);
});
