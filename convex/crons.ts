import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
// Recovers a dropped continuation; leases and freshness keep this from duplicating pulls.
crons.interval("Resume Exact synchronization", { minutes: 5 }, internal.exactSync.pump, {});
crons.interval("Resume mailbox receipt imports", { minutes: 5 }, internal.statementMailboxSync.pump, {});
export default crons;
