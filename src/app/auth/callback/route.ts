import { NextResponse } from "next/server";
import { buildLoginPath } from "@/lib/auth-paths";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL(buildLoginPath(), request.url));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Expired or reused confirmation links land here; never forward Supabase's raw message.
    return NextResponse.redirect(new URL(buildLoginPath({ reason: "callback-failed" }), request.url));
  }

  return NextResponse.redirect(new URL("/dashboard", request.url));
}
