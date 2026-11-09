import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
// Recovers a dropped continuation; leases and freshness keep this from duplicating pulls.
crons.interval("Resume Exact synchronization", { minutes: 5 }, internal.exactSync.pump, {});
crons.interval("Resume mailbox receipt imports", { minutes: 5 }, internal.statementMailboxSync.pump, {});
crons.interval("Research queued statement merchants", { minutes: 1 }, internal.statementIntelligence.pump, {});
crons.interval("Process approved statement automation",{minutes:1},internal.statementAutomation.pump,{});
crons.interval("Import saved Revolut activity into Statements", {minutes:5}, internal.statementRevolut.pump, {});
crons.interval("Synchronize MZS Bouw accounting", {minutes:15}, internal.rompslompSync.pump, {});
export default crons;
