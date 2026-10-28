/**
 * The engineer's own environment, as their shell would hand it over.
 *
 * Agents and quality blocks are meant to see exactly what the operator sees:
 * their PATH, their toolchains, their globally installed packages. Under bun
 * that is simply `process.env` — bun runs the workflow directly, with no
 * ephemeral environment of its own interposed, and it loads `.env` itself so
 * there is no dotenv activity either.
 *
 * KEEP THIS FUNCTION even though it is currently a pass-through. The Python
 * factory this was ported from needed real surgery here: workflows launched
 * under `uv run`, which prepends an ephemeral venv's bin to PATH, so every
 * `python3`, `pip`, and globally installed CLI a subprocess resolved was
 * silently the wrong one. If pi-crust ever gains a launcher that wraps the process,
 * the same class of bug returns — and this is the single place to fix it,
 * because nothing else hands an environment to a child.
 */
export const operatorEnv = (): Readonly<Record<string, string>> =>
  process.env as Record<string, string>
