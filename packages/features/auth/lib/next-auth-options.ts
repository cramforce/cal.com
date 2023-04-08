import type { UserPermissionRole, Membership, Team } from "@prisma/client";
import { IdentityProvider } from "@prisma/client";
import { SignJWT } from "jose";
import type { AuthOptions, Session } from "next-auth";
import { encode } from "next-auth/jwt";
import type { Provider } from "next-auth/providers";

import checkLicense from "@calcom/features/ee/common/server/checkLicense";
import { hostedCal } from "@calcom/features/ee/sso/lib/saml";
import { IS_TEAM_BILLING_ENABLED, WEBAPP_URL, WEBSITE_URL } from "@calcom/lib/constants";
import { defaultCookies } from "@calcom/lib/default-cookies";
import { randomString } from "@calcom/lib/random";
import slugify from "@calcom/lib/slugify";
import prisma from "@calcom/prisma";
import { teamMetadataSchema, userMetadata } from "@calcom/prisma/zod-utils";

const GOOGLE_API_CREDENTIALS = process.env.GOOGLE_API_CREDENTIALS || "{}";
const { client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET } =
  JSON.parse(GOOGLE_API_CREDENTIALS)?.web || {};
const GOOGLE_LOGIN_ENABLED = process.env.GOOGLE_LOGIN_ENABLED === "true";
const IS_GOOGLE_LOGIN_ENABLED = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_LOGIN_ENABLED);

const usernameSlug = (username: string) => slugify(username) + "-" + randomString(6).toLowerCase();

const signJwt = async (payload: { email: string }) => {
  const secret = new TextEncoder().encode(process.env.CALENDSO_ENCRYPTION_KEY);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.email)
    .setIssuedAt()
    .setIssuer(WEBSITE_URL)
    .setAudience(`${WEBSITE_URL}/auth/login`)
    .setExpirationTime("2m")
    .sign(secret);
};

const loginWithTotp = async (user: { email: string }) =>
  `/auth/login?totp=${await signJwt({ email: user.email })}`;

type UserTeams = {
  teams: (Membership & {
    team: Team;
  })[];
};

const checkIfUserBelongsToActiveTeam = <T extends UserTeams>(user: T): boolean =>
  user.teams.filter((m: { team: { metadata: unknown } }) => {
    if (!IS_TEAM_BILLING_ENABLED) return true;
    const metadata = teamMetadataSchema.safeParse(m.team.metadata);
    if (metadata.success && metadata.data?.subscriptionId) return true;
    return false;
  }).length > 0;

const providers: Provider[] = [];

function isNumber(n: string) {
  return !isNaN(parseFloat(n)) && !isNaN(+n);
}

const mapIdentityProvider = (providerName: string) => {
  switch (providerName) {
    case "saml-idp":
    case "saml":
      return IdentityProvider.SAML;
    default:
      return IdentityProvider.GOOGLE;
  }
};

export const AUTH_OPTIONS: AuthOptions = {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  adapter: undefined,
  session: {
    strategy: "jwt",
  },
  jwt: {
    // decorate the native JWT encode function
    // Impl. detail: We don't pass through as this function is called with encode/decode functions.
    encode: async ({ token, maxAge, secret }) => {
      if (token?.sub && isNumber(token.sub)) {
        const user = await prisma.user.findFirst({
          where: { id: Number(token.sub) },
          select: { metadata: true },
        });
        // if no user is found, we still don't want to crash here.
        if (user) {
          const metadata = userMetadata.parse(user.metadata);
          if (metadata?.sessionTimeout) {
            maxAge = metadata.sessionTimeout * 60;
          }
        }
      }
      return encode({ secret, token, maxAge });
    },
  },
  cookies: defaultCookies(WEBAPP_URL?.startsWith("https://")),
  pages: {
    signIn: "/auth/login",
    signOut: "/auth/logout",
    error: "/auth/error", // Error code passed in query string as ?error=
    verifyRequest: "/auth/verify",
    // newUser: "/auth/new", // New users will be directed here on first sign in (leave the property out if not of interest)
  },
  providers,
  callbacks: {
    async jwt({ token, user, account }) {
      const autoMergeIdentities = async () => {
        const existingUser = await prisma.user.findFirst({
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          where: { email: token.email! },
          select: {
            id: true,
            username: true,
            name: true,
            email: true,
            role: true,
            teams: {
              include: {
                team: true,
              },
            },
          },
        });

        if (!existingUser) {
          return token;
        }

        // Check if the existingUser has any active teams
        const belongsToActiveTeam = checkIfUserBelongsToActiveTeam(existingUser);
        const { teams, ...existingUserWithoutTeamsField } = existingUser;

        return {
          ...existingUserWithoutTeamsField,
          ...token,
          belongsToActiveTeam,
        };
      };
      if (!user) {
        return await autoMergeIdentities();
      }
      if (!account) {
        return token;
      }
      if (account.type === "credentials") {
        // return token if credentials,saml-idp
        if (account.provider === "saml-idp") {
          return token;
        }
        // any other credentials, add user info
        return {
          ...token,
          id: user.id,
          name: user.name,
          username: user.username,
          email: user.email,
          role: user.role,
          impersonatedByUID: user?.impersonatedByUID,
          belongsToActiveTeam: user?.belongsToActiveTeam,
        };
      }

      // The arguments above are from the provider so we need to look up the
      // user based on those values in order to construct a JWT.
      if (account.type === "oauth") {
        if (!account.provider || !account.providerAccountId) {
          return token;
        }
        const idP = account.provider === "saml" ? IdentityProvider.SAML : IdentityProvider.GOOGLE;

        const existingUser = await prisma.user.findFirst({
          where: {
            AND: [
              {
                identityProvider: idP,
              },
              {
                identityProviderId: account.providerAccountId,
              },
            ],
          },
        });

        if (!existingUser) {
          return await autoMergeIdentities();
        }

        return {
          ...token,
          id: existingUser.id,
          name: existingUser.name,
          username: existingUser.username,
          email: existingUser.email,
          role: existingUser.role,
          impersonatedByUID: token.impersonatedByUID as number,
          belongsToActiveTeam: token?.belongsToActiveTeam as boolean,
        };
      }

      return token;
    },
    async session({ session, token }) {
      const hasValidLicense = await checkLicense(prisma);
      const calendsoSession: Session = {
        ...session,
        hasValidLicense,
        user: {
          ...session.user,
          id: token.id as number,
          name: token.name,
          username: token.username as string,
          role: token.role as UserPermissionRole,
          impersonatedByUID: token.impersonatedByUID as number,
          belongsToActiveTeam: token?.belongsToActiveTeam as boolean,
        },
      };
      return calendsoSession;
    },
    async signIn(params) {
      const { user, account, profile } = params;

      if (account?.provider === "email") {
        return true;
      }

      // In this case we've already verified the credentials in the authorize
      // callback so we can sign the user in.
      // Only if provider is not saml-idp
      if (account?.provider !== "saml-idp") {
        if (account?.type === "credentials") {
          return true;
        }

        if (account?.type !== "oauth") {
          return false;
        }
      }

      if (!user.email) {
        return false;
      }

      if (!user.name) {
        return false;
      }

      if (account?.provider) {
        const idP: IdentityProvider = mapIdentityProvider(account.provider);
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore-error TODO validate email_verified key on profile
        user.email_verified = user.email_verified || !!user.emailVerified || profile.email_verified;

        if (!user.email_verified) {
          return "/auth/error?error=unverified-email";
        }

        let existingUser = await prisma.user.findFirst({
          include: {
            accounts: {
              where: {
                provider: account.provider,
              },
            },
          },
          where: {
            identityProvider: idP,
            identityProviderId: account.providerAccountId,
          },
        });

        /* --- START FIX LEGACY ISSUE WHERE 'identityProviderId' was accidentally set to userId --- */
        if (!existingUser) {
          existingUser = await prisma.user.findFirst({
            include: {
              accounts: {
                where: {
                  provider: account.provider,
                },
              },
            },
            where: {
              identityProvider: idP,
              identityProviderId: String(user.id),
            },
          });
          if (existingUser) {
            await prisma.user.update({
              where: {
                id: existingUser?.id,
              },
              data: {
                identityProviderId: account.providerAccountId,
              },
            });
          }
        }
        /* --- END FIXES LEGACY ISSUE WHERE 'identityProviderId' was accidentally set to userId --- */
        if (existingUser) {
          // In this case there's an existing user and their email address
          // hasn't changed since they last logged in.
          if (existingUser.email === user.email) {
            try {
              // If old user without Account entry we link their google account
              if (existingUser.accounts.length === 0) {
                const linkAccountWithUserData = { ...account, userId: existingUser.id };
                await calcomAdapter.linkAccount(linkAccountWithUserData);
              }
            } catch (error) {
              if (error instanceof Error) {
                console.error("Error while linking account of already existing user");
              }
            }
            if (existingUser.twoFactorEnabled) {
              return loginWithTotp(existingUser);
            } else {
              return true;
            }
          }

          // If the email address doesn't match, check if an account already exists
          // with the new email address. If it does, for now we return an error. If
          // not, update the email of their account and log them in.
          const userWithNewEmail = await prisma.user.findFirst({
            where: { email: user.email },
          });

          if (!userWithNewEmail) {
            await prisma.user.update({ where: { id: existingUser.id }, data: { email: user.email } });
            if (existingUser.twoFactorEnabled) {
              return loginWithTotp(existingUser);
            } else {
              return true;
            }
          } else {
            return "/auth/error?error=new-email-conflict";
          }
        }

        // If there's no existing user for this identity provider and id, create
        // a new account. If an account already exists with the incoming email
        // address return an error for now.
        const existingUserWithEmail = await prisma.user.findFirst({
          where: {
            email: {
              equals: user.email,
              mode: "insensitive",
            },
          },
        });

        if (existingUserWithEmail) {
          // if self-hosted then we can allow auto-merge of identity providers if email is verified
          if (!hostedCal && existingUserWithEmail.emailVerified) {
            if (existingUserWithEmail.twoFactorEnabled) {
              return loginWithTotp(existingUserWithEmail);
            } else {
              return true;
            }
          }

          // check if user was invited
          if (
            !existingUserWithEmail.password &&
            !existingUserWithEmail.emailVerified &&
            !existingUserWithEmail.username
          ) {
            await prisma.user.update({
              where: { email: existingUserWithEmail.email },
              data: {
                // update the email to the IdP email
                email: user.email,
                // Slugify the incoming name and append a few random characters to
                // prevent conflicts for users with the same name.
                username: usernameSlug(user.name),
                emailVerified: new Date(Date.now()),
                name: user.name,
                identityProvider: idP,
                identityProviderId: account.providerAccountId,
              },
            });

            if (existingUserWithEmail.twoFactorEnabled) {
              return loginWithTotp(existingUserWithEmail);
            } else {
              return true;
            }
          }

          // User signs up with email/password and then tries to login with Google/SAML using the same email
          if (
            existingUserWithEmail.identityProvider === IdentityProvider.CAL &&
            (idP === IdentityProvider.GOOGLE || idP === IdentityProvider.SAML)
          ) {
            await prisma.user.update({
              where: { email: existingUserWithEmail.email },
              // also update email to the IdP email
              data: {
                password: null,
                email: user.email,
                identityProvider: idP,
                identityProviderId: account.providerAccountId,
              },
            });
            if (existingUserWithEmail.twoFactorEnabled) {
              return loginWithTotp(existingUserWithEmail);
            } else {
              return true;
            }
          } else if (existingUserWithEmail.identityProvider === IdentityProvider.CAL) {
            return "/auth/error?error=use-password-login";
          }

          return "/auth/error?error=use-identity-login";
        }

        const newUser = await prisma.user.create({
          data: {
            // Slugify the incoming name and append a few random characters to
            // prevent conflicts for users with the same name.
            username: usernameSlug(user.name),
            emailVerified: new Date(Date.now()),
            name: user.name,
            email: user.email,
            identityProvider: idP,
            identityProviderId: account.providerAccountId,
          },
        });

        const linkAccountNewUserData = { ...account, userId: newUser.id };
        await calcomAdapter.linkAccount(linkAccountNewUserData);

        if (account.twoFactorEnabled) {
          return loginWithTotp(newUser);
        } else {
          return true;
        }
      }

      return false;
    },
    async redirect({ url, baseUrl }) {
      // Allows relative callback URLs
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      // Allows callback URLs on the same domain
      else if (new URL(url).hostname === new URL(WEBAPP_URL).hostname) return url;
      return baseUrl;
    },
  },
};
