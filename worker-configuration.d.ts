/* eslint-disable */
// Generated from wrangler.jsonc and .env.example; runtime library types come from tsconfig.
export {};

interface Fetcher {
	fetch(request: Request): Promise<Response>;
}

interface __BaseEnv_Env {
	ASSETS: Fetcher;
	PUBLIC_APP_URL: string;
	PORT: string;
	VITE_API_BASE: string;
	VITE_CONVEX_URL: string;
	CONVEX_URL: string;
	CONVEX_DEPLOYMENT: string;
	CONVEX_SERVICE_TOKEN: string;
	MANAGEMENT_REPORT_IMPORT_TOKEN: string;
	AUTH_USERNAME: string;
	AUTH_PASSWORD_HASH: string;
	AUTH_SESSION_SECRET: string;
	SLASH_AUTH_USERNAME: string;
	SLASH_AUTH_PASSWORD_HASH: string;
	OPENROUTER_API_KEY: string;
	WISE_API_TOKEN: string;
	WISE_CONNECTION_ID: string;
	WISE_PROFILE_IDS: string;
	WISE_ENVIRONMENT: string;
	REVOLUT_ENVIRONMENT: string;
	REVOLUT_CONNECTION_ID: string;
	REVOLUT_CLIENT_ID: string;
	REVOLUT_ISSUER: string;
	REVOLUT_PRIVATE_KEY_PEM: string;
	REVOLUT_REFRESH_TOKEN: string;
	SLASH_API_KEY: string;
	SLASH_CONNECTION_ID: string;
	SLASH_LEGAL_ENTITY_ID: string;
	SLASH_BASE_URL: string;
	AMEX_TOKEN_URL: string;
	AMEX_API_BASE_URL: string;
	AMEX_CONNECTION_ID: string;
	AMEX_CLIENT_ID: string;
	AMEX_CLIENT_SECRET: string;
	AMEX_REFRESH_TOKEN: string;
	AMEX_ACCOUNT_IDS: string;
	AMEX_ACCOUNT_PATH_TEMPLATE: string;
	AMEX_TRANSACTIONS_PATH_TEMPLATE: string;
	AMEX_TRANSACTIONS_ITEMS_PATH: string;
	AMEX_TRANSACTIONS_NEXT_CURSOR_PATH: string;
	AMEX_TRANSACTIONS_CURSOR_PARAM: string;
	AMEX_TRANSACTIONS_PAGE_SIZE_PARAM: string;
	AMEX_TRANSACTIONS_PAGE_SIZE: string;
	MERIT_API_BASE_URL: string;
	MERIT_GET_INVOICES_PATH: string;
	MERIT_CREATE_INVOICE_PATH: string;
	MERIT_DELIVER_INVOICE_PATH: string;
	MERIT_API_ID: string;
	MERIT_API_KEY: string;
	MERIT_WRITES_ENABLED: string;
	MERIT_DEFAULT_ITEM_CODE: string;
	MERIT_DEFAULT_COUNTRY_CODE: string;
	REVENUE_TIMEZONE: string;
	KISSTERRA_TUNE_NETWORK_ID: string;
	KISSTERRA_TUNE_API_KEY: string;
	KISSTERRA_TUNE_API_BASE_URL: string;
	COINBASE_SPOT_PRICES_URL: string;
}

declare namespace Cloudflare {
	interface GlobalProps {
		mainModule: typeof import("./worker/index");
	}
	interface Env extends __BaseEnv_Env {}
}

interface Env extends __BaseEnv_Env {}

type StringifyValues<EnvType extends Record<string, unknown>> = {
	[Binding in keyof EnvType]: EnvType[Binding] extends string ? EnvType[Binding] : string;
};

declare namespace NodeJS {
	interface ProcessEnv extends StringifyValues<__BaseEnv_Env> {}
}

export type WorkerEnv = Env;
export interface WorkerScheduledController {
	readonly scheduledTime: number;
	readonly cron: string;
	noRetry(): void;
}
export interface WorkerExecutionContext {
	waitUntil(promise: Promise<unknown>): void;
}
export interface WorkerExportedHandler {
	fetch(request: Request, env: Env, ctx: WorkerExecutionContext): Response | Promise<Response>;
	scheduled?(controller: WorkerScheduledController, env: Env, ctx: WorkerExecutionContext): void | Promise<void>;
}
