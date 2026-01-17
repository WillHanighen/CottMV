/**
 * GitHub OAuth Helper Functions
 * =============================
 * 
 * This file contains helper functions for GitHub OAuth authentication.
 * It handles the OAuth flow: redirect to GitHub -> callback with code -> exchange for token.
 * 
 * OAuth Flow:
 * 1. User clicks "Login with GitHub"
 * 2. We redirect them to GitHub's authorization URL
 * 3. User authorizes our app on GitHub
 * 4. GitHub redirects back to our callback URL with a code
 * 5. We exchange the code for an access token
 * 6. We use the token to fetch user info from GitHub API
 * 7. We create/update the user in our database and create a session
 * 
 * Environment Variables Required:
 * - GITHUB_CLIENT_ID: Your GitHub OAuth app client ID
 * - GITHUB_CLIENT_SECRET: Your GitHub OAuth app client secret
 * - APP_URL: Your app's base URL (for callback)
 */

/**
 * GitHub user data returned from the API
 */
export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

/**
 * GitHub OAuth token response
 */
interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  error?: string;
  error_description?: string;
}

/**
 * Get the GitHub OAuth authorization URL
 * This is where we redirect users to start the login process
 * 
 * @param clientId - GitHub OAuth app client ID
 * @param redirectUri - Where GitHub should redirect after authorization
 * @param state - Random string to prevent CSRF attacks
 * @returns The full GitHub authorization URL
 */
export function getAuthorizationUrl(
  clientId: string,
  redirectUri: string,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read:user user:email",
    state: state,
  });
  
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange an authorization code for an access token
 * Called after GitHub redirects back to our callback URL
 * 
 * @param clientId - GitHub OAuth app client ID
 * @param clientSecret - GitHub OAuth app client secret
 * @param code - The authorization code from GitHub
 * @returns The access token or throws an error
 */
export async function exchangeCodeForToken(
  clientId: string,
  clientSecret: string,
  code: string
): Promise<string> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code: code,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`GitHub token exchange failed: ${response.status}`);
  }
  
  const data: GitHubTokenResponse = await response.json();
  
  if (data.error) {
    throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
  }
  
  return data.access_token;
}

/**
 * Fetch user information from GitHub API
 * Called after we have an access token
 * 
 * @param accessToken - The GitHub access token
 * @returns GitHub user data
 */
export async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "CottMV-Media-Vault",
    },
  });
  
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }
  
  const user: GitHubUser = await response.json();
  
  // If email is not public, try to fetch from emails endpoint
  if (!user.email) {
    try {
      const emailResponse = await fetch("https://api.github.com/user/emails", {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "CottMV-Media-Vault",
        },
      });
      
      if (emailResponse.ok) {
        const emails: Array<{ email: string; primary: boolean; verified: boolean }> = 
          await emailResponse.json();
        
        // Find the primary verified email
        const primaryEmail = emails.find((e) => e.primary && e.verified);
        if (primaryEmail) {
          user.email = primaryEmail.email;
        }
      }
    } catch {
      // Email fetch failed, continue without email
      console.warn("Could not fetch user email from GitHub");
    }
  }
  
  return user;
}

/**
 * Generate a random state string for CSRF protection
 * This should be stored in a cookie and verified on callback
 */
export function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate a random session token
 * This is what we store in the user's cookie
 */
export function generateSessionToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Hash a session token for storage
 * We never store plain tokens in the database!
 * 
 * @param token - The plain session token
 * @returns SHA-256 hash of the token
 */
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
