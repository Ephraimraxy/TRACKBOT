import type { JWT } from "next-auth/jwt";
import NextAuth, { type Session, type User } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

import { authorizeCredentials } from "@/lib/auth/credentials";
import { prisma } from "@/lib/utils/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  // AUTH_SECRET is preferred; NEXTAUTH_SECRET and JWT_SECRET are accepted names.
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? process.env.JWT_SECRET,
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: (credentials): Promise<User | null> => authorizeCredentials(credentials),
    }),
  ],

  session: {
    strategy: "jwt",
    // A signed-in customer stays signed in on their device for 30 days.
    maxAge: 60 * 60 * 24 * 30,
  },

  callbacks: {
    async jwt({
      token,
      user,
      session,
      trigger,
    }: {
      token: JWT;
      user: User;
      session?: Session;
      trigger?: "signIn" | "signUp" | "update";
    }): Promise<JWT> {
      // If the user is signing in, add user data to the token
      if (trigger === "signIn" && user) {
        token.id = user.id!;
        token.email = user.email!;
        token.nom = user.nom;
        token.prenom = user.prenom;
        token.role = user.role;
        token.emailVerifie = user.emailVerifie;
        token.imagePublicId = user.imagePublicId;
      }

      // If the user is updating their session, fetch the latest user data
      if (trigger === "update" && session?.user) {
        const dbUser = await prisma.user.findUnique({
          where: { id: session.user.id },
          select: {
            id: true,
            email: true,
            nom: true,
            prenom: true,
            role: true,
            emailVerifie: true,
            imagePublicId: true,
          },
        });

        if (dbUser) {
          token.id = dbUser.id;
          token.email = dbUser.email;
          token.nom = dbUser.nom;
          token.prenom = dbUser.prenom;
          token.role = dbUser.role;
          token.emailVerifie = dbUser.emailVerifie;
          token.imagePublicId = dbUser.imagePublicId;
        }
      }

      return token;
    },

    async session({ session, token }) {
      session.user.id = token.id;
      session.user.email = token.email;
      session.user.nom = token.nom;
      session.user.prenom = token.prenom;
      session.user.role = token.role;
      session.user.emailVerifie = token.emailVerifie;
      session.user.imagePublicId = token.imagePublicId;
      return session;
    },
  },
});
