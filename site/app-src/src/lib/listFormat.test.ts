import { describe, it, expect } from 'vitest'
import { joinNames } from './listFormat'

describe('joinNames 名字列表按语言连接', () => {
  it('中文用顿号「、」、英文用逗号「, 」（此前硬编码「、」，英文界面显示 Alice、Bob）', () => {
    expect(joinNames(['Alice', 'Bob'], 'zh')).toBe('Alice、Bob')
    expect(joinNames(['Alice', 'Bob'], 'en')).toBe('Alice, Bob')
    expect(joinNames(['单个'], 'en')).toBe('单个') // 单元素两语言都不带分隔符
  })
  it('空列表返回 fallback（默认「—」）', () => {
    expect(joinNames([], 'zh')).toBe('—')
    expect(joinNames([], 'en')).toBe('—')
    expect(joinNames([], 'en', 'none')).toBe('none')
  })
})
