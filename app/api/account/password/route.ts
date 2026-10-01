import {NextResponse} from "next/server";
import {createServiceClient} from "@/lib/supabase/server";

export async function POST(request:Request){
 const token=request.headers.get("authorization")?.replace(/^Bearer /,"");
 if(!token)return NextResponse.json({error:"Unauthorized"},{status:401});
 const db=createServiceClient();const{data:{user}}=await db.auth.getUser(token);
 if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const{password}=await request.json();
 if(typeof password!=="string"||password.length<12)return NextResponse.json({error:"Use at least 12 characters"},{status:400});
 const result=await db.auth.admin.updateUserById(user.id,{password});
 if(result.error)return NextResponse.json({error:result.error.message},{status:400});
 await db.from("profiles").update({must_change_password:false}).eq("id",user.id);
 return NextResponse.json({ok:true});
}
