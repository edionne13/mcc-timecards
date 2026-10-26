import test from 'node:test';
import assert from 'node:assert/strict';
import {submissionDeadline, pacificDateTime} from '../lib/payroll.ts';
test('submission opens at midnight Pacific on the 27th', () => {
 assert.equal(submissionDeadline('2026-10-01',new Date('2026-10-27T06:59:59Z')).open,false);
 assert.equal(submissionDeadline('2026-10-01',new Date('2026-10-27T07:00:00Z')).open,true);
 assert.equal(submissionDeadline('2026-10-01',new Date('2026-10-30T12:00:00Z')).open,true);
});
test('late submissions stay open and future months remain closed', () => {
 const now=new Date('2026-11-01T20:00:00Z');
 assert.equal(submissionDeadline('2026-10-01',now).open,true);
 assert.equal(submissionDeadline('2026-10-01',now).late,true);
 assert.equal(submissionDeadline('2026-11-01',now).open,false);
});
test('February and leap months open on the 27th', () => {
 assert.equal(submissionDeadline('2027-02-01',new Date('2027-02-27T08:00:00Z')).open,true);
 assert.match(submissionDeadline('2028-02-01',new Date()).label,/February 29/);
});
test('noon Pacific deadline preserves existing late flag', () => {
 assert.equal(submissionDeadline('2026-10-01',new Date('2026-10-31T18:59:59Z')).late,false);
 assert.equal(submissionDeadline('2026-10-01',new Date('2026-10-31T19:00:00Z')).late,true);
});
test('Saturday planned hours retain Pacific time on devices in other zones', () => {
 assert.equal(pacificDateTime('2026-10-31T09:00').toISOString(),'2026-10-31T16:00:00.000Z');
 assert.equal(pacificDateTime('2026-12-05T09:00').toISOString(),'2026-12-05T17:00:00.000Z');
 assert.ok(Number.isNaN(pacificDateTime('2027-03-14T02:30').getTime()));
 assert.ok(Number.isNaN(pacificDateTime('bad').getTime()));
});
