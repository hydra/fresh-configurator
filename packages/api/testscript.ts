import { open, ports, readAdvancedPidConfig } from "./src";

(async () => {
  const port = (await ports())[1]!;
  await open(port);
  console.log(await readAdvancedPidConfig(port));
})();