import { describe, expect, it } from 'vitest';
import { effectiveRisk, removeProtectionRule, samePath } from './analysis';
import { demoReport } from './demo';

describe('removing a single saved protection rule', () => {
  it('keeps ancestor, descendant and sibling rules', () => {
    const paths = ['C:/work', 'C:/work/build', 'C:/work/build/local', 'C:/work/dist'];
    expect(removeProtectionRule(paths, 'C:/work/build')).toEqual(['C:/work', 'C:/work/build/local', 'C:/work/dist']);
    expect(paths).toHaveLength(4);
  });
  it('matches canonical Windows aliases and preserves POSIX case distinctions', () => {
    expect(samePath('\\\\?\\C:\\WORK\\build\\', 'c:/work/build')).toBe(true);
    expect(removeProtectionRule(['C:/WORK/build', '/Work/build'], 'c:\\work\\build')).toEqual(['/Work/build']);
    expect(removeProtectionRule(['/Work/build'], '/work/build')).toEqual(['/Work/build']);
    expect(samePath('', '')).toBe(false);
  });
  it('cannot remove a shared ancestor through a child path', () => {
    const paths = ['C:/work/build'];
    const remaining = removeProtectionRule(paths, 'C:/work/build/tool/node_modules');
    expect(remaining).toEqual(paths);
    expect(effectiveRisk({ ...demoReport().findings[0], path: 'C:/work/build/tool/dist' }, remaining)).toBe('protected');
  });
  it('preserves independent and intrinsic protection after explicit rule removal', () => {
    const remaining = removeProtectionRule(['C:/work/build', 'C:/work/build/tool/dist'], 'C:/work/build');
    expect(effectiveRisk({ ...demoReport().findings[0], path: 'C:/work/build/tool/dist' }, remaining)).toBe('protected');
    expect(effectiveRisk({ ...demoReport().findings[0], risk: 'protected' }, [])).toBe('protected');
  });
});
