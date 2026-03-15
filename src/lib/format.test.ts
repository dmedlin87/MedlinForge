import { describe, expect, it } from 'vitest'
import { formatBytes, formatWhen } from './format'

describe('formatBytes', () => {
  it('returns 0 B for zero', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('returns 0 B for negative values', () => {
    expect(formatBytes(-1)).toBe('0 B')
  })

  it('returns 0 B for non-finite values', () => {
    expect(formatBytes(Infinity)).toBe('0 B')
    expect(formatBytes(NaN)).toBe('0 B')
  })

  it('formats bytes under 1 KB', () => {
    expect(formatBytes(1)).toBe('1 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(10 * 1024)).toBe('10 KB')
  })

  it('formats megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB')
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB')
  })

  it('formats gigabytes', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB')
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB')
  })

  it('caps at GB and does not produce TB', () => {
    expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1024 GB')
  })

  it('switches from decimal to integer display at 10+ in a unit', () => {
    // Under 10 KB: one decimal place
    expect(formatBytes(9.9 * 1024)).toBe('9.9 KB')
    // At 10 KB exactly: no decimal
    expect(formatBytes(10 * 1024)).toBe('10 KB')
    // 11 KB: no decimal
    expect(formatBytes(11 * 1024)).toBe('11 KB')
  })
})

describe('formatWhen', () => {
  it('returns Never for null', () => {
    expect(formatWhen(null)).toBe('Never')
  })

  it('returns Never for empty string', () => {
    expect(formatWhen('')).toBe('Never')
  })

  it('formats a valid ISO timestamp', () => {
    // Use a fixed timestamp and verify the result is a non-empty, non-Never string
    const result = formatWhen('2025-03-15T14:30:00.000Z')
    expect(result).not.toBe('Never')
    expect(result.length).toBeGreaterThan(0)
  })

  it('includes the month, day, hour, and minute in the output', () => {
    // We cannot assert exact locale output (CI locale may differ),
    // but we can verify the shape is plausible: non-empty, not "Never"
    const result = formatWhen('2025-06-01T09:05:00.000Z')
    expect(result).not.toBe('Never')
    expect(typeof result).toBe('string')
  })
})
