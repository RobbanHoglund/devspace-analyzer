import {test, expect} from 'vitest';
import {demoReport} from './demo';
import {unclassifiedMeasuredBytes} from './measurement';
test('unclassified measured data includes a scan with files but no findings', () => {
  const r=demoReport();r.progress.logicalBytes=100;r.findings=[];expect(unclassifiedMeasuredBytes(r)).toBe(100);
  r.findings=[{...demoReport().findings[0],logicalBytes:70}];expect(unclassifiedMeasuredBytes(r)).toBe(30);
  r.cancelled=true;expect(unclassifiedMeasuredBytes(r)).toBe(30); // observed files only
});
test('inconsistent or imprecise totals do not create invented remainder values', () => {
  const r=demoReport();r.progress.logicalBytes=1;expect(unclassifiedMeasuredBytes(r)).toBeNull();
  r.progress.logicalBytes=Number.MAX_SAFE_INTEGER+1;expect(unclassifiedMeasuredBytes(r)).toBeNull();
});
