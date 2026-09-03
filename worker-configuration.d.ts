/* eslint-disable */
// Worker bindings mirror wrangler.jsonc and .env.example. Runtime declarations stay
// local because global Cloudflare DOM types conflict with the browser application.
interface Fetcher {
	fetch(request: Request): Promise<Response>;
}

interface DurableObjectStorage {
	get<T>(key: string): Promise<T | undefined>;
	put<T>(key: string, value: T): Promise<void>;
	delete(key: string): Promise<boolean>;
	setAlarm(scheduledTime: number | Date): Promise<void>;
	deleteAlarm(): Promise<void>;
}

interface DurableObjectState {
	readonly storage: DurableObjectStorage;
}

interface DurableObjectNamespace<T> {
	getByName(name: string): T;
}

declare module "cloudflare:workers" {
	export class DurableObject<Env = WorkerEnv> {
		protected readonly ctx: DurableObjectState;
		protected readonly env: Env;
		constructor(ctx: DurableObjectState, env: Env);
	}
}

interface ExecutionContext {
	waitUntil(promise: Promise<unknown>): void;
}

interface ScheduledController {
	readonly scheduledTime: number;
	readonly cron: string;
	noRetry(): void;
}

interface ExportedHandler<Env> {
	fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
	scheduled?(controller: ScheduledController, env: Env, ctx: ExecutionContext): void | Promise<void>;
}
interface __BaseEnv_WorkerEnv {
	ASSETS: Fetcher;
	PUBLIC_APP_URL: "https://finance.thatcanadian.dev";
	PORT: string;
	VITE_API_BASE: string;
	VITE_CONVEX_URL: string;
	CONVEX_URL: string;
	CONVEX_DEPLOYMENT: string;
	CONVEX_SERVICE_TOKEN: string;
	BANK_LEDGER_LEGACY_DISPOSITION: string;
	BANK_LEDGER_ORPHAN_ASSIGNMENT_DISPOSITION: string;
	MANAGEMENT_REPORT_IMPORT_TOKEN: string;
	AUTH_SESSION_SECRET: string;
	TELEGRAM_BOT_TOKEN: string;
	TELEGRAM_AUTH_USERS_JSON: string;
	TELEGRAM_PASSWORDLESS_USERS_JSON: string;
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
	SLASH_CASH_ALERT_THRESHOLD_USD: string;
	SLASH_CASH_ALERT_RECIPIENT: string;
	AMEX_TOKEN_URL: string;
	AMEX_CONNECTION_ID: string;
	AMEX_API_BASE_URL: string;
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
	LEMONMAX_AUTH_TOKEN: string;
	LEMONMAX_BEARER_TOKEN: string;
	LEMONMAX_SPEND_CURRENCY: string;
	LEMONMAX_SYNC_START_DATE: string;
	TELEGRAM_OTP_STATE: DurableObjectNamespace<import("./worker/index").TelegramOtpState>;
}
declare namespace Cloudflare {
	interface GlobalProps {
		mainModule: typeof import("./worker/index");
		durableNamespaces: "TelegramOtpState";
	}
	interface Env extends __BaseEnv_WorkerEnv {}
}
interface WorkerEnv extends __BaseEnv_WorkerEnv {}
