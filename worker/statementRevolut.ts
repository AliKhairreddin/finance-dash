import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { requireBankConnectionKey } from "../shared/bankConnectionIdentity";
import { fetchRevolutAccountOwners } from "../shared/revolutApi";
export async function discoverStatementRevolut(env: WorkerEnv): Promise<void> {
 if(!env.REVOLUT_CLIENT_ID || !env.REVOLUT_PRIVATE_KEY_PEM || !env.REVOLUT_REFRESH_TOKEN)return;
 const client=new ConvexHttpClient(env.CONVEX_URL),connectionKey=await requireBankConnectionKey(env,"revolut"),token=crypto.randomUUID();
 const credentials={serviceToken:env.CONVEX_SERVICE_TOKEN,connectionKey,token};
 if(!await client.mutation(api.statementRevolut.discoveryLease,credentials))return;
 try {
  const accounts=await fetchRevolutAccountOwners({environment:env.REVOLUT_ENVIRONMENT,clientId:env.REVOLUT_CLIENT_ID,issuer:env.REVOLUT_ISSUER,privateKeyPem:env.REVOLUT_PRIVATE_KEY_PEM,refreshToken:env.REVOLUT_REFRESH_TOKEN});
  await client.mutation(api.statementRevolut.discovered,{...credentials,accounts});
 }catch(error){await client.mutation(api.statementRevolut.discovered,{...credentials,accounts:[],error:error instanceof Error?error.message.slice(0,200):"Revolut account discovery failed"});throw error;}
}
