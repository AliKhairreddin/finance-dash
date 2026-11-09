import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { fetchRevolutAccountOwners, fetchRevolutActivityBatch, RevolutApiError } from "../shared/revolutApi";

// A provider cooldown belongs in durable scheduling, not a short in-request retry.
export function lmdRevolutFetcher(fetcher: typeof fetch): typeof fetch {
  return async(input, init)=>{
    const response=await fetcher(input,init);
    const header=response.headers.get("retry-after")?.trim();
    if(response.status===429 || (!response.ok && header)){
      const retryAt=header?(/^\d+(?:\.\d+)?$/.test(header)?Date.now()+Number(header)*1000:Date.parse(header)):undefined;
      await response.body?.cancel();
      throw new RevolutApiError(response.status,"Revolut requested a delayed retry",retryAt!==undefined&&Number.isFinite(retryAt)?retryAt:undefined);
    }
    return response;
  };
}

/** Independent LMD feed. DN's Finance credentials and bank connection binding are never changed. */
export async function syncStatementRevolutLmd(env: WorkerEnv): Promise<void> {
  const clientId=env.REVOLUT_LMD_CLIENT_ID, privateKeyPem=env.REVOLUT_LMD_PRIVATE_KEY_PEM, refreshToken=env.REVOLUT_LMD_REFRESH_TOKEN;
  if(!clientId && !privateKeyPem && !refreshToken)return;
  if(!clientId || !privateKeyPem || !refreshToken)throw new Error("LMD Revolut credentials are incomplete");
  const client=new ConvexHttpClient(env.CONVEX_URL);
  const auth={serviceToken:env.CONVEX_SERVICE_TOKEN,token:crypto.randomUUID()};
  const lease=await client.mutation(api.statementRevolutFeed.acquire,auth);
  if(!lease)return;
  const credentials={environment:"production",clientId,privateKeyPem,refreshToken,issuer:env.REVOLUT_ISSUER,fetcher:lmdRevolutFetcher(fetch)};
  try {
    if(lease.discover)await client.mutation(api.statementRevolutFeed.directory,{...auth,accounts:await fetchRevolutAccountOwners(credentials)});
    const result=await fetchRevolutActivityBatch({
      ...credentials,...(lease.checkpoint?{checkpoint:lease.checkpoint}:{dateRange:{fromDate:lease.fromDate,toDate:lease.toDate}}),
      pageBudget:3,collectTransactions:false,
      onTransactionPage:async(rows)=>{
        for(let offset=0;offset<rows.length;offset+=50){
          const transactions=rows.slice(offset,offset+50).map(row=>{
            if(!row.accountId)throw new Error("LMD Revolut transaction account is missing");
            return {id:row.id,accountId:row.accountId,date:row.date,description:row.description,counterparty:row.counterparty,amount:row.amount,currency:row.currency,direction:row.direction,status:row.status,...(row.reference?{reference:row.reference}:{}),...(row.cardLastFour?{cardLastFour:row.cardLastFour}:{})};
          });
          await client.mutation(api.statementRevolutFeed.ingest,{...auth,transactions});
        }
      }
    });
    await client.mutation(api.statementRevolutFeed.finish,{...auth,checkpoint:result.nextCheckpoint,accounts:result.accounts.map(({id,currency,balance})=>({id,currency,balance}))});
  }catch(error){
    // Do not persist provider bodies: they can contain confidential request details.
    const message=error instanceof RevolutApiError?`LMD Revolut returned HTTP ${error.status}; saved data retained.`:"LMD Revolut synchronization failed; saved data retained. Check authorization and account ownership.";
    await client.mutation(api.statementRevolutFeed.failed,{...auth,error:message,...(error instanceof RevolutApiError&&error.retryAt?{retryAt:error.retryAt}:{})});
    throw new Error(message);
  }
}
