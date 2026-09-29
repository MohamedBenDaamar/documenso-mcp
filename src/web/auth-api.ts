import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** A browser session on the consent and account pages. */
export type WebSession = {
  userId: string;
  email: string | null;
  accessToken: string;
  refreshToken: string;
};

export type AuthorizationRequest =
  | { kind: "consent"; clientName: string; redirectUri: string; scopes: string[] }
  | { kind: "redirect"; url: string }
  | { kind: "invalid" };

export type Grant = { clientId: string; clientName: string; scopes: string[]; grantedAt: string };

/** The Supabase Auth operations the web pages need. Every method returns null or false on failure. */
export type AuthApi = {
  signIn(email: string, password: string): Promise<WebSession | null>;
  /** Validates stored tokens, refreshing them if the access token expired. */
  restore(accessToken: string, refreshToken: string): Promise<WebSession | null>;
  getAuthorizationRequest(session: WebSession, authorizationId: string): Promise<AuthorizationRequest>;
  decide(session: WebSession, authorizationId: string, approve: boolean): Promise<string | null>;
  listGrants(session: WebSession): Promise<Grant[] | null>;
  revokeGrant(session: WebSession, clientId: string): Promise<boolean>;
};

type SupabaseAuthOptions = {
  supabaseUrl: string;
  publishableKey: string;
};

/**
 * Logs which Supabase Auth operation failed, with Supabase's error code and HTTP status only.
 * Never logs tokens, emails or error messages.
 */
function logAuthFailure(operation: string, error: { status?: number; code?: string } | null) {
  console.warn(
    JSON.stringify({ event: "supabase_auth_failure", operation, status: error?.status ?? null, code: error?.code ?? null }),
  );
}

export function createSupabaseAuthApi({ supabaseUrl, publishableKey }: SupabaseAuthOptions): AuthApi {
  function newClient(): SupabaseClient {
    return createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  async function clientWith(accessToken: string, refreshToken: string) {
    const supabase = newClient();
    const { data, error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });

    if (error || !data.session) {
      logAuthFailure("restore_session", error);
      return null;
    }

    const session: WebSession = {
      userId: data.session.user.id,
      email: data.session.user.email ?? null,
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    };

    return { supabase, session };
  }

  return {
    async signIn(email, password) {
      const { data, error } = await newClient().auth.signInWithPassword({ email, password });

      if (error || !data.session) {
        logAuthFailure("sign_in", error);
        return null;
      }

      return {
        userId: data.session.user.id,
        email: data.session.user.email ?? null,
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      };
    },

    async restore(accessToken, refreshToken) {
      return (await clientWith(accessToken, refreshToken))?.session ?? null;
    },

    async getAuthorizationRequest(session, authorizationId) {
      const restored = await clientWith(session.accessToken, session.refreshToken);

      if (!restored) {
        return { kind: "invalid" };
      }

      const { data, error } = await restored.supabase.auth.oauth.getAuthorizationDetails(authorizationId);

      if (error || !data) {
        logAuthFailure("get_authorization_details", error);
        return { kind: "invalid" };
      }

      if ("redirect_url" in data) {
        return { kind: "redirect", url: data.redirect_url };
      }

      return {
        kind: "consent",
        clientName: data.client.name || "Unknown application",
        redirectUri: data.redirect_uri,
        scopes: data.scope ? data.scope.split(" ").filter(Boolean) : [],
      };
    },

    async decide(session, authorizationId, approve) {
      const restored = await clientWith(session.accessToken, session.refreshToken);

      if (!restored) {
        return null;
      }

      const { data, error } = approve
        ? await restored.supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
        : await restored.supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });

      if (error || !data) {
        logAuthFailure(approve ? "approve_authorization" : "deny_authorization", error);
        return null;
      }

      return data.redirect_url;
    },

    async listGrants(session) {
      const restored = await clientWith(session.accessToken, session.refreshToken);

      if (!restored) {
        return null;
      }

      const { data, error } = await restored.supabase.auth.oauth.listGrants();

      if (error || !data) {
        logAuthFailure("list_grants", error);
        return null;
      }

      return data.map((grant) => ({
        clientId: grant.client.id,
        clientName: grant.client.name || "Unknown application",
        scopes: grant.scopes,
        grantedAt: grant.granted_at,
      }));
    },

    async revokeGrant(session, clientId) {
      const restored = await clientWith(session.accessToken, session.refreshToken);

      if (!restored) {
        return false;
      }

      const { error } = await restored.supabase.auth.oauth.revokeGrant({ clientId });

      if (error) {
        logAuthFailure("revoke_grant", error);
        return false;
      }

      return true;
    },
  };
}
