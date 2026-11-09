"use node";
import {v} from "convex/values";
import {action,internalAction} from "./_generated/server";
import {api,internal} from "./_generated/api";
import {exactEncrypt,exactDecrypt} from "../shared/exactHttp";
import {rompslompList,rompslompRow,RompslompError,type RompslompRow} from "../shared/rompslomp";
const key=()=>{if(!process.env.ROMPSLOMP_ENCRYPTION_KEY)throw new Error("Rompslomp encryption is not configured");return process.env.ROMPSLOMP_ENCRYPTION_KEY;};
export const connect=action({args:{serviceToken:v.string(),actor:v.string(),token:v.string()},returns:v.null(),handler:async(ctx,a)=>{
 await ctx.runQuery(api.rompslomp.authorize,{serviceToken:a.serviceToken,actor:a.actor});if(!a.token.trim()||a.token.length>2000)throw new Error("Enter a valid API token");
 const companies=await rompslompList(a.token,"companies","companies");
 const matches=companies.filter(c=>String(c.kvk_number)==="89354907"&&String(c.name).toLowerCase().replace(/[^a-z]/g,"")==="mzsbouw");
 if(matches.length!==1)throw new Error("The API token does not identify MZS Bouw (KVK 89354907)");
 await ctx.runMutation(internal.rompslomp.connect,{serviceToken:a.serviceToken,actor:a.actor,companyNumber:Number(matches[0].id),encryptedToken:await exactEncrypt(a.token.trim(),key())});return null;
}});
export const pump=internalAction({args:{},returns:v.null(),handler:async(ctx)=>{
 const lease=crypto.randomUUID(),raw=await ctx.runMutation(internal.rompslomp.claim,{token:lease});if(!raw)return null;
 const saved=JSON.parse(raw),full=saved.lastFullAt<Date.now()-7*86400000;
 try{
  const token=await exactDecrypt(saved.encryptedToken,key()),from=full?null:new Date(Date.now()-90*86400000).toISOString().slice(0,10);
  const fresh:RompslompRow[]=[];
  for(const kind of ["sales_invoices","expenses"] as const){const records=await rompslompList(token,`companies/${saved.companyNumber}/${kind}`,kind,{selection:"all",...(from?{"search[from]":from}:{})});fresh.push(...records.map(r=>rompslompRow(r,kind)));}
  const old:RompslompRow[]=JSON.parse(saved.dataJson),freshIds=new Set(fresh.map(r=>`${r.kind}:${r.id}`));
  const rows=[...(from?old.filter(r=>r.date<from&&!freshIds.has(`${r.kind}:${r.id}`)):[]),...fresh];
  const dataJson=JSON.stringify(rows);if(new TextEncoder().encode(dataJson).length>800000)throw new Error("Rompslomp snapshot is too large; saved records preserved");
  await ctx.runMutation(internal.rompslomp.finish,{token:lease,dataJson,full});
 }catch(error){await ctx.runMutation(internal.rompslomp.finish,{token:lease,full:false,error:error instanceof Error?error.message.slice(0,250):"Rompslomp sync failed",retryMs:error instanceof RompslompError?error.retryAfterMs:3600000});}
 return null;
}});
