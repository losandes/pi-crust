import { expect, test } from 'bun:test'
import { hrefFor, parseHash } from './router'

test(
  [
    'given lib/router::parseHash',
    'when the link predates workspaces',
    'it should still mean the run it always meant',
  ].join(', '),
  () => {
    // given — bookmarks, pasted links and anything a developer typed. A
    // routing change that invalidates them is a routing change that loses
    // people their open tabs.
    const old = '#/c35f2c7d/c35f2c7d_03_design'

    // when
    const actual = parseHash(old)

    // then
    expect(actual).toEqual({
      runId: 'c35f2c7d',
      phaseId: 'c35f2c7d_03_design',
      workspace: undefined,
    })
  },
)

test(
  [
    'given lib/router::parseHash',
    'when the link names a workspace',
    'it should read both, and keep the phase in the second segment',
  ].join(', '),
  () => {
    // given — a colon rather than another slash, so the phase id does not
    // slide along depending on whether a workspace precedes it
    const link = '#/feature-a:c35f2c7d/c35f2c7d_03_design'

    // when
    const actual = parseHash(link)

    // then
    expect(actual).toEqual({
      runId: 'c35f2c7d',
      phaseId: 'c35f2c7d_03_design',
      workspace: 'feature-a',
    })
  },
)

test(
  [
    'given lib/router::hrefFor',
    'when a workspace is known and when it is not',
    'it should address the run exactly once either way',
  ].join(', '),
  () => {
    // given — an unqualified link is a complete address on its own: the
    // server finds the run across every tree it watches
    const cases = [
      hrefFor('c35f2c7d'),
      hrefFor('c35f2c7d', 'p1'),
      hrefFor('c35f2c7d', undefined, 'feature-a'),
      hrefFor('c35f2c7d', 'p1', 'feature-a'),
      hrefFor('c35f2c7d', 'p1', ''),
      hrefFor(),
    ]

    // when
    const actual = cases

    // then
    expect(actual).toEqual([
      '#/c35f2c7d',
      '#/c35f2c7d/p1',
      '#/feature-a:c35f2c7d',
      '#/feature-a:c35f2c7d/p1',
      '#/c35f2c7d/p1',
      '#/',
    ])
  },
)

test(
  [
    'given lib/router::hrefFor and parseHash',
    'when a label or id contains a character that needs escaping',
    'it should survive the round trip',
  ].join(', '),
  () => {
    // given — labels are slugified server-side, but nothing stops a hand
    // typed link, and a half-escaped one routes somewhere unintended
    const href = hrefFor('run/one', 'phase one', 'tree:two')

    // when
    const actual = parseHash(href)

    // then — the workspace splits at the FIRST colon, which is the delimiter
    expect(actual).toEqual({
      workspace: 'tree',
      runId: 'two:run/one',
      phaseId: 'phase one',
    })
  },
)
