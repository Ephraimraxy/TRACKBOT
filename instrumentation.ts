// Runs once when the Next.js server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { validateEnv } = await import("./lib/config/env");
  const { warnings } = validateEnv(); // throws with the missing variable NAMES if misconfigured
  for (const w of warnings) console.warn(`[env] ${w}`);
}
