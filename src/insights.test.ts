import { describe, expect, it } from 'vitest';
import { demoReport } from './demo';
import { findingTitle, reviewCandidates, reviewStep } from './insights';

describe('result guidance respects the scanner evidence', () => {
  it('distinguishes Gradle output and local cache without relabelling a protected aggregate', () => {
    const build = demoReport().findings[6];
    const cache = { ...build, path: 'C:\\work\\project\\.gradle' };
    expect(findingTitle(build)).toBe('Gradle build output');
    expect(findingTitle(cache)).toBe('Gradle project cache');
    expect(reviewStep(build, [])).toContain('configured build outputs');
    expect(reviewStep(cache, [])).toContain('local Gradle state');
    expect(findingTitle({ ...cache, risk: 'protected', label: 'Contains protected project' })).toBe('Contains protected project');
  });
  it('never promotes partial, empty or personally protected locations into a recommendation', () => {
    const findings = demoReport().findings;
    findings[0].complete = false;
    findings[4].logicalBytes = 0;
    const selected = reviewCandidates(findings, [findings[1].path]);
    expect(selected.map(f => f.id)).toEqual(['f5', 'f6', 'f7', 'f8']);
    expect(reviewStep(findings[0], [])).toContain('excluded from the review total');
    expect(reviewStep(findings[1], [findings[1].path])).toContain('You protected this location');
  });
  it('does not confuse a missing wrapper reference with disuse or hide protected contents', () => {
    const wrapper = demoReport().findings[4];
    expect(reviewStep(wrapper, [])).toContain('does not establish that it is unused');
    expect(reviewStep({ ...wrapper, risk: 'protected', protectedDescendantCount: 2 }, [])).toContain('do not treat the whole folder as disposable');
  });
});
