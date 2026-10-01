import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET() {
  const { error } = await createServiceClient().from("organizations").select("id", { count: "exact", head: true });
  return NextResponse.json({ ok: !error, database: error ? "unavailable" : "connected" }, { status: error ? 503 : 200 });
}

