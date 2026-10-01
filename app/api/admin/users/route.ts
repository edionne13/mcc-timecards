import {randomBytes} from "node:crypto";
import {NextResponse} from "next/server";
import {createServiceClient} from "@/lib/supabase/server";

const PRIMARY_SUPERVISOR_EMAIL = "tyuen@maccov.org";

export async function POST(request:Request){
 const token=request.headers.get("authorization")?.replace(/^Bearer /,"");
 if(!token)return NextResponse.json({error:"Unauthorized"},{status:401});
 const db=createServiceClient();
 const{data:{user}}=await db.auth.getUser(token);
 if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const{data:caller}=await db.from("profiles").select("role,organization_id,active").eq("id",user.id).single();
 if(caller?.role!=="admin")return NextResponse.json({error:"Administrator access required"},{status:403});
 const body=await request.json();
 const email=typeof body.email==="string"?body.email.trim().toLowerCase():"";
 const displayName=typeof body.displayName==="string"?body.displayName.trim():"";
 const role=body.role;
 if(!email||!displayName||!["employee","supervisor"].includes(role))return NextResponse.json({error:"Valid name, email, and role are required"},{status:400});
 const temporaryPassword=`Mcc!${randomBytes(9).toString("base64url")}9a`;
 const created=await db.auth.admin.createUser({email,password:temporaryPassword,email_confirm:true,user_metadata:{display_name:displayName}});
 if(created.error)return NextResponse.json({error:created.error.message},{status:400});
 const profileUpdate=await db.from("profiles").update({display_name:displayName,role,organization_id:caller.organization_id,must_change_password:true}).eq("id",created.data.user.id);
 if(profileUpdate.error){
  await db.auth.admin.deleteUser(created.data.user.id);
  return NextResponse.json({error:"The staff profile could not be created. Please try again."},{status:500});
 }
 const {data:authUsers}=await db.auth.admin.listUsers({page:1,perPage:1000});
 const ted=authUsers.users.find((candidate)=>candidate.email?.toLowerCase()===PRIMARY_SUPERVISOR_EMAIL);
 if(role==="employee"&&ted){
  await db.from("supervisor_assignments").upsert({organization_id:caller.organization_id,employee_id:created.data.user.id,supervisor_id:ted.id,active:true},{onConflict:"employee_id,supervisor_id"});
 }
 if(role==="supervisor"&&email.toLowerCase()===PRIMARY_SUPERVISOR_EMAIL){
  const{data:employees}=await db.from("profiles").select("id").eq("organization_id",caller.organization_id).eq("role","employee");
  if(employees?.length)await db.from("supervisor_assignments").upsert(employees.map((employee)=>({organization_id:caller.organization_id,employee_id:employee.id,supervisor_id:created.data.user.id,active:true})),{onConflict:"employee_id,supervisor_id"});
 }
 return NextResponse.json({temporaryPassword});
}
