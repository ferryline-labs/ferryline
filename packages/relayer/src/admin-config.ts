/**
 * Genuinely more sensitive than an integrator's own API key: anyone holding FERRYLINE_ADMIN_SECRET
 * can mint unlimited real, spend-capable integrator keys via POST /admin/api-keys, all sharing the
 * same sponsor account and the same daily spend ceiling (see spend/config.ts's own
 * FERRYLINE_DAILY_SPEND_CEILING_STROOPS — that ceiling is shared across every key this admin secret
 * can create). Required, no default, no silent fallback — the same "no default values for anything
 * spend-adjacent" discipline spend/config.ts's own loadSpendConfig already holds every
 * spend-related value to, applied here because this credential is one authenticated call away from
 * spend-capable access, not because it is a spend value itself.
 */
export interface AdminConfig {
  readonly adminSecret: string;
}

function requireEnv(env: NodeJS.ProcessEnv, name: string, hint: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required (${hint}). The relayer refuses to start without it.`);
  }
  return value;
}

export function loadAdminConfig(env: NodeJS.ProcessEnv = process.env): AdminConfig {
  return {
    adminSecret: requireEnv(
      env,
      "FERRYLINE_ADMIN_SECRET",
      "the bearer secret gating POST/DELETE /admin/api-keys — anyone holding it can mint unlimited " +
        "real, spend-capable integrator API keys, so this must be a real, separately-generated " +
        "secret, never reused from any integrator key or the sponsor secrets",
    ),
  };
}
