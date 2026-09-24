/**
 * Entry point for the single-executable (SEA) build. Inside a SEA binary the
 * bundled module's import.meta.url is an embedded-resource URL, so the
 * isMain guard in cli.mjs never fires — this launcher calls main explicitly.
 * Every path still funnels through main(); there is exactly one orchestration.
 */
import { main } from './cli.mjs';

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
