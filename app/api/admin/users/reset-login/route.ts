import {randomBytes} from "node:crypto";
import {NextResponse} from "next/server";
import {createServiceClient} from "@/lib/supabase/server";

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return NextResponse.json({error:"Unauthorized"}, {status:401});
  const db = createServiceClient();
  const {data:{user}, error:authError} = await db.auth.getUser(token);
  if (authError || !user) return NextResponse.json({error:"Unauthorized"}, {status:401});
  const {data:caller} = await db.from("profiles").select("role,organization_id,active,must_change_password").eq("id",user.id).single();
  if (!caller?.active || caller.role !== "admin" || caller.must_change_password)
    return NextResponse.json({error:"Administrator access required"}, {status:403});
  const body = await request.json().catch(() => null) as {userId?:unknown} | null;
  if (typeof body?.userId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.userId))
    return NextResponse.json({error:"Select a staff account"}, {status:400});
  const {data:target} = await db.from("profiles").select("id,role,active,organization_id,must_change_password")
    .eq("id",body.userId).eq("organization_id",caller.organization_id).single();
  if (!target?.active || !["employee","supervisor"].includes(target.role))
    return NextResponse.json({error:"Active staff account not found"}, {status:404});
  const {data:account,error:accountError} = await db.auth.admin.getUserById(target.id);
  if (accountError || !account.user?.email)
    return NextResponse.json({error:"Staff login not found"}, {status:404});
  // Require password setup before changing the credential, so failures cannot
  // accidentally let a temporary credential bypass the setup screen.
  const {error:profileError} = await db.from("profiles").update({must_change_password:true}).eq("id",target.id);
  if (profileError) return NextResponse.json({error:"Could not prepare password setup"}, {status:500});
  const temporaryPassword = "Mcc!" + randomBytes(18).toString("base64url") + "9a";
  const {error} = await db.auth.admin.updateUserById(target.id,{password:temporaryPassword});
  if (error) {
    await db.from("profiles").update({must_change_password:target.must_change_password}).eq("id",target.id);
    return NextResponse.json({error:"Could not reset login. Please try again."}, {status:500});
  }
  await db.from("audit_events").insert({organization_id:caller.organization_id,actor_id:user.id,
    subject_id:target.id,action:"staff_login_reset",after_value:{must_change_password:true}});
  return NextResponse.json({email:account.user.email,temporaryPassword}, {headers:{"Cache-Control":"no-store"}});
}
