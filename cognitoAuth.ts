
import { UserManager } from "oidc-client-ts";

const cognitoAuthConfig = {
  authority:
    "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_c5C1pfdSB",
  client_id: "3ps2eb8tav5573ltahmmunos8r",
  redirect_uri: "http://127.0.0.1:3000/",
  response_type: "code",
  scope: "phone openid email",
};

export const userManager = new UserManager({
  ...cognitoAuthConfig,
});

export async function signInRedirect() {
  await userManager.signinRedirect();
}

export async function signOutRedirect() {
  await userManager.removeUser();
  const logoutUri = "http://127.0.0.1:3000/";

  const logoutUrl = new URL(
    "https://ap-southeast-2c5c1pfdsb.auth.ap-southeast-2.amazoncognito.com/logout"
  );

  logoutUrl.searchParams.set(
    "client_id",
    cognitoAuthConfig.client_id
  );
  logoutUrl.searchParams.set("logout_uri", logoutUri);

  window.location.assign(logoutUrl.toString());
}

export async function completeSignIn() {
  return await userManager.signinRedirectCallback();
}

export async function getCurrentUser() {
  return await userManager.getUser();
}
