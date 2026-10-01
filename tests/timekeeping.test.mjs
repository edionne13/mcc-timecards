import test from"node:test";import assert from"node:assert/strict";import{paidHours,weeklyTotals,warnings,notificationKey}from"../lib/timekeeping.mjs";
test("paid hours deduct meal without rounding",()=>assert.equal(paidHours({start:"08:00",lunchStart:"12:00",lunchEnd:"12:30",end:"16:45"}),8.25));
test("requires complete lunch",()=>assert.throws(()=>paidHours({start:"08:00",lunchStart:"12:00",end:"16:00"}),/both/));
test("rejects invalid ordering",()=>assert.throws(()=>paidHours({start:"09:00",end:"08:00"}),/after/));
test("warns for missing and short meals",()=>{assert.equal(warnings({start:"08:00",end:"15:00"}).length,1);assert.equal(warnings({start:"08:00",lunchStart:"12:00",lunchEnd:"12:15",end:"16:00"}).length,1)});
test("weekly overtime honors week boundary",()=>{const r=weeklyTotals([{date:"2026-09-05",hours:9},{date:"2026-09-06",hours:41}]);assert.equal(r.length,2);assert.equal(r[1].overtime,1)});
test("notification dedupe key is stable",()=>assert.equal(notificationKey("month_due","u1","2026-09"),notificationKey("month_due","u1","2026-09")));
