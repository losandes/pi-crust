import { expect, test } from 'bun:test'
import { uiAddresses, uiListenerFromEnv } from './ui-listener'

for (const row of [
  { env: {}, expected: undefined },
  { env: { CRUST_UI_HOST: '  ' }, expected: undefined },
  ...['0', '1234', '65535', '-1', '65536', '1.5', 'abc', '', '2x'].map(
    (port) => ({
      env: { CRUST_UI_HOST: '127.0.0.1', CRUST_FE_PORT: port },
      expected: {
        host: '127.0.0.1',
        port: ['0', '1234', '65535'].includes(port) ? Number(port) : 4601,
      },
    }),
  ),
  { env: { CRUST_UI_HOST: '::1' }, expected: { host: '::1', port: 4601 } },
])
  test(
    [
      'given launcher environment',
      `when parsing ${JSON.stringify(row.env)}`,
      'it should choose only a valid UI listener',
    ].join(', '),
    () => {
      // given
      // when
      const actual = uiListenerFromEnv(row.env)
      // then
      expect(actual).toEqual(row.expected)
    },
  )

for (const row of [
  { host: '127.0.0.1', expected: ['http://localhost:42'] },
  {
    host: '0.0.0.0',
    expected: [
      'http://localhost:42',
      'http://10.0.0.1:42',
      'http://10.0.0.2:42',
    ],
  },
  { host: '::1', expected: ['http://[::1]:42'] },
  { host: 'machine', expected: ['http://machine:42'] },
])
  test(
    [
      'given network interfaces',
      `when formatting ${row.host}`,
      'it should print browser addresses for the selected binding',
    ].join(', '),
    () => {
      // given
      const interfaces = {
        absent: undefined,
        lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
        eth: [
          { address: '::2', family: 'IPv6', internal: false },
          { address: '10.0.0.1', family: 'IPv4', internal: false },
          { address: '10.0.0.2', family: 'IPv4', internal: false },
        ],
      }
      // when
      const actual = uiAddresses(row.host, 42, interfaces)
      // then
      expect(actual).toEqual(row.expected)
    },
  )
