import { describe, expect, it } from 'vitest'
import { compareVersions, isNewerVersion, parseVersion } from './version'

describe('parseVersion', () => {
  it('parses a plain major.minor.patch', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  it('accepts a leading v, case-insensitively', () => {
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
    expect(parseVersion('V1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  it('trims surrounding whitespace', () => {
    expect(parseVersion('  1.2.3  ')).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  it('rejects malformed input rather than guessing', () => {
    expect(parseVersion('')).toBeNull()
    expect(parseVersion('v')).toBeNull()
    expect(parseVersion('not-a-version')).toBeNull()
    expect(parseVersion('1.2')).toBeNull()
  })
})

describe('compareVersions', () => {
  it('is 0 when both sides are equal', () => {
    expect(
      compareVersions({ major: 1, minor: 2, patch: 3 }, { major: 1, minor: 2, patch: 3 })
    ).toBe(0)
  })

  it('is 1 when the first is newer, at each position', () => {
    expect(
      compareVersions({ major: 2, minor: 0, patch: 0 }, { major: 1, minor: 9, patch: 9 })
    ).toBe(1)
    expect(
      compareVersions({ major: 1, minor: 3, patch: 0 }, { major: 1, minor: 2, patch: 9 })
    ).toBe(1)
    expect(
      compareVersions({ major: 1, minor: 2, patch: 4 }, { major: 1, minor: 2, patch: 3 })
    ).toBe(1)
  })

  it('is -1 when the first is older, at each position', () => {
    expect(
      compareVersions({ major: 1, minor: 9, patch: 9 }, { major: 2, minor: 0, patch: 0 })
    ).toBe(-1)
    expect(
      compareVersions({ major: 1, minor: 2, patch: 9 }, { major: 1, minor: 3, patch: 0 })
    ).toBe(-1)
    expect(
      compareVersions({ major: 1, minor: 2, patch: 3 }, { major: 1, minor: 2, patch: 4 })
    ).toBe(-1)
  })
})

describe('isNewerVersion', () => {
  it('is false when the tag equals the current version', () => {
    expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false)
  })

  it('is false when the tag is older', () => {
    expect(isNewerVersion('1.2.3', '1.2.2')).toBe(false)
  })

  it('is true when the tag is newer', () => {
    expect(isNewerVersion('1.2.3', '1.2.4')).toBe(true)
  })

  it('ignores a leading v on either side', () => {
    expect(isNewerVersion('v1.0.0', '1.0.1')).toBe(true)
    expect(isNewerVersion('1.0.0', 'v1.0.1')).toBe(true)
  })

  it('fails safe — never claims an update when either side is malformed', () => {
    expect(isNewerVersion('', '1.0.0')).toBe(false)
    expect(isNewerVersion('1.0.0', '')).toBe(false)
    expect(isNewerVersion('v', '1.0.0')).toBe(false)
    expect(isNewerVersion('not-a-version', '1.0.0')).toBe(false)
    expect(isNewerVersion('1.0.0', 'not-a-version')).toBe(false)
    expect(isNewerVersion('1.2', '1.0.0')).toBe(false)
  })
})
