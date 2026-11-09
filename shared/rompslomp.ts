import { readBoundedResponseJson } from "./boundedHttp";
export type RompslompRow={id:string;kind:"sales_invoices"|"expenses";date:string;number:string;description:string;contact:string;amount:string;currency:"EUR";status:string};
export class RompslompError extends Error { constructor(message:string,readonly retryAfterMs=3600000){super(message)} }
export async function rompslompList(token:string,path:string,key:string,params:Record<string,string>={},fetcher:typeof fetch=fetch):Promise<Record<string,unknown>[]> {
 const rows:Record<string,unknown>[]=[];let expected:number|undefined;
 for(let page=1;page<=50;page++){
  const url=new URL(`https://api.rompslomp.nl/api/v1/${path}`);url.search=new URLSearchParams({...params,per_page:"100",page:String(page)}).toString();
  const response=await fetcher(url,{headers:{Authorization:`Bearer ${token}`,Accept:"application/json"},signal:AbortSignal.timeout(25000)});
  if(!response.ok){const retry=response.headers.get("Retry-After");await response.body?.cancel();throw new RompslompError(`Rompslomp returned ${response.status}. Saved records are preserved.`,Math.max(3600000,Math.min(86400000,retry && /^\d+$/.test(retry) ? Number(retry)*1000 : Math.max(0, Date.parse(retry??"")-Date.now())||0)));}
  const total=Number(response.headers.get("X-Total")),reportedPage=Number(response.headers.get("X-Page"));
  if(!response.headers.has("X-Total")||!Number.isSafeInteger(total)||total<0||total>5000||reportedPage!==page||expected!==undefined&&expected!==total){await response.body?.cancel();throw new Error("Rompslomp pagination changed or is incomplete; retry later");}
  expected=total;const data=await readBoundedResponseJson<Record<string,unknown>>(response,"Rompslomp",1500000),items=data[key];
  if(!Array.isArray(items)||items.length>100||items.some(item=>!item||typeof item!=="object"||!Number.isSafeInteger(item.id)))throw new Error("Invalid Rompslomp records");
  rows.push(...items);if(rows.length===total){if(new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error("Duplicate Rompslomp records");return rows;}
  if(items.length!==100||rows.length>total)throw new Error("Incomplete Rompslomp response; saved records preserved");
 }
 throw new Error("Rompslomp record limit reached; saved records preserved");
}
export function rompslompRow(value:Record<string,unknown>,kind:RompslompRow["kind"]):RompslompRow {
 const text=(v:unknown)=>typeof v==="string"?v.slice(0,1000):"";
 const lines=Array.isArray(value.invoice_lines)?value.invoice_lines as Record<string,unknown>[]:[];
 const sum=(values:unknown[])=>{let total=0n;for(const value of values){if(typeof value!=="string"||!/^(-?)(\d+)(?:\.(\d{1,8}))?$/.test(value))throw new Error("Missing expense line total");const match=/^(-?)(\d+)(?:\.(\d+))?$/.exec(value)!;total+=(match[1]?-1n:1n)*(BigInt(match[2])*100000000n+BigInt((match[3]??"").padEnd(8,"0")));}const sign=total<0n?"-":"",digits=(total<0n?-total:total).toString().padStart(9,"0");return `${sign}${digits.slice(0,-8)}.${digits.slice(-8)}`;};
 const amount=kind==="expenses"&&lines.length?sum(lines.map(line=>line.price_with_vat)):text(value.price_with_vat),date=text(value.date).slice(0,10);
 if(!/^-?\d+(?:\.\d{1,8})?$/.test(amount)||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Rompslomp returned an invalid amount or date");
 const sourceContact=value.cached_contact??value.contact;const contact=sourceContact&&typeof sourceContact==="object"?sourceContact as Record<string,unknown>:{};
 return {id:String(value.id),kind,date,number:text(value.invoice_number),description:text(value.description)||lines.map(l=>text(l.description)).filter(Boolean).join("; ").slice(0,1000),contact:text(contact.name)||text(contact.company_name),amount,currency:"EUR",status:text(value.payment_status)||text(value.status)||text(value.state)};
}
