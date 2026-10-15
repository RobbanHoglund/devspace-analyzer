import {test, expect} from 'vitest';
import {scopeKey} from './scanScope';
test('equivalent Windows roots are stable while cache settings and Unix case matter', () => {
  expect(scopeKey({roots:['C:/Work/', 'D:/Repo'],includeCaches:true})).toBe(scopeKey({roots:['d:/repo','c:/work'],includeCaches:true}));
  expect(scopeKey({roots:['/Work'],includeCaches:true})).not.toBe(scopeKey({roots:['/work'],includeCaches:true}));
  expect(scopeKey({roots:[],includeCaches:true})).not.toBe(scopeKey({roots:[],includeCaches:false}));
});
