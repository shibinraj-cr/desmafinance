import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { env } from "./env";

// Pin cookie names explicitly so the middleware's getToken() and the
// credentials handler always agree, regardless of NEXTAUTH_URL detection
// quirks across Node and Edge runtimes on Vercel.
const useSecure = (process.env.NEXTAUTH_URL ?? "").startsWith("https://");
const sessionCookieName = useSecure
  ? "__Secure-next-auth.session-token"
  : "next-auth.session-token";

export const SESSION_COOKIE_NAME = sessionCookieName;
export const SESSION_COOKIE_SECURE = useSecure;

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 },
  pages: { signIn: "/login" },
  useSecureCookies: useSecure,
  cookies: {
    sessionToken: {
      name: sessionCookieName,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecure,
      },
    },
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials.password) return null;
        const user = await prisma.user.findUnique({
          where: { username: credentials.username.trim().toLowerCase() },
        });
        if (!user) return null;
        const ok = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!ok) return null;
        // Deactivated accounts can't sign in (their data is kept, just no access).
        if (!user.isActive) return null;
        return { id: user.id, name: user.username, email: user.email ?? undefined, role: user.role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.role = user.role ?? "user";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid;
        session.user.role = token.role ?? "user";
      }
      return session;
    },
  },
  secret: env.NEXTAUTH_SECRET,
};
