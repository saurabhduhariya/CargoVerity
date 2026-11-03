import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPrisma } from "@/lib/db";

export type AppRole = "EXECUTIVE" | "MANAGER";

export async function getAuthenticatedSupabaseUser() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) return null;
  return data.user;
}

export async function requireAppUser() {
  const authUser = await getAuthenticatedSupabaseUser();

  if (!authUser?.email) {
    throw new Error("AUTHENTICATION_REQUIRED");
  }

  const prisma = getPrisma();
  const appUser = await prisma.user.upsert({
    where: { id: authUser.id },
    update: { email: authUser.email },
    create: {
      id: authUser.id,
      email: authUser.email,
      fullName:
        typeof authUser.user_metadata?.full_name === "string"
          ? authUser.user_metadata.full_name
          : null,
    },
  });

  return { authUser, appUser };
}

export async function requireUser() {
  const { authUser } = await requireAppUser();
  return authUser;
}

export async function requireRole(role: AppRole) {
  const current = await requireAppUser();

  if (current.appUser.role !== role) {
    throw new Error("FORBIDDEN");
  }

  return current;
}
