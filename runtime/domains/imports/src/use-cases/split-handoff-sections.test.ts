import { expect, test } from 'bun:test'
import { end, section } from '../import-fixture.test'
import { splitHandoffSections } from './split-handoff-sections'

for (const { name, body, expected } of [
  {
    name: 'SC5 round trip',
    body: `preamble\n${section('Identify', 'SC1\n---\n```\n---\n> _Handoff: Fake_\n---\n```')}${section('Plan', 'build it')}\n${end}epilogue`,
    expected: {
      preamble: 'preamble\n',
      sections: [
        {
          label: 'Identify',
          text: 'SC1\n---\n```\n---\n> _Handoff: Fake_\n---\n```\n',
        },
        { label: 'Plan', text: 'build it\n' },
      ],
      epilogue: 'epilogue\n',
      dividers: 2,
    },
  },
  {
    name: 'no divider',
    body: `plain\n${end}`,
    expected: {
      preamble: `plain\n${end}`,
      sections: [],
      epilogue: '',
      dividers: 0,
    },
  },
  {
    name: 'no end marker',
    body: section('Plan', 'build it'),
    expected: {
      preamble: '',
      sections: [{ label: 'Plan', text: 'build it\n' }],
      epilogue: '',
      dividers: 1,
    },
  },
  {
    name: 'four backticks hiding three',
    body: section(
      'Plan',
      `\n\n\`\`\`\`\n\`\`\`\n${section('Fake', 'quoted')}\`\`\`\`\nrest\n\n`,
    ),
    expected: {
      preamble: '',
      sections: [
        {
          label: 'Plan',
          text: `\`\`\`\`\n\`\`\`\n${section('Fake', 'quoted')}\`\`\`\`\nrest\n`,
        },
      ],
      epilogue: '',
      dividers: 1,
    },
  },
  {
    name: 'CRLF',
    body: '--- \r\n> _Handoff: Plan_\t\r\n---\r\n\r\none\r\ntwo\r\n',
    expected: {
      preamble: '',
      sections: [{ label: 'Plan', text: 'one\r\ntwo\n' }],
      epilogue: '',
      dividers: 1,
    },
  },
  {
    name: 'unclosed tilde fence',
    body: `~~~\n${section('Plan', 'not a section')}`,
    expected: {
      preamble: `~~~\n${section('Plan', 'not a section')}`,
      sections: [],
      epilogue: '',
      dividers: 0,
    },
  },
  {
    name: 'closed tilde fence and blank section',
    body: `~~~\ninside\n~~~~\n${section('Plan', '\n')}${end}`,
    expected: {
      preamble: '~~~\ninside\n~~~~\n',
      sections: [{ label: 'Plan', text: '' }],
      epilogue: '',
      dividers: 1,
    },
  },
]) {
  test(
    [
      'given handoff text',
      `when splitting ${name}`,
      'it should preserve content and ignore fenced markers',
    ].join(', '),
    () => {
      // given
      // when
      const actual = splitHandoffSections(body)
      // then
      expect(actual).toEqual(expected)
    },
  )
}
