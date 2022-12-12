import test from 'ava'
import { execaSync } from 'execa'

test('w3', async (t) => {
  t.throws(() => {
    execaSync('./bin.js')
  }, { message: /No command specified./ })
})

test('w3 --version', (t) => {
  const { stdout } = execaSync('./bin.js', ['--version'])
  t.regex(stdout, /w3, \d.\d.\d/)
})

test('w3 whoami', (t) => {
  const { stdout } = execaSync('./bin.js', ['whoami'])
  t.regex(stdout, /^did:key:/)
})

test('w3 space create', (t) => {
  const { stdout } = execaSync('./bin.js', ['space', 'create'])
  t.regex(stdout, /^did:key:/)
})
