import test from 'ava'
import { filesFromPaths } from '../lib.js'

test('filesFromPaths', async (t) => {
  const files = await filesFromPaths(['node_modules'])
  t.log(`${files.length} files in node_modules`)
  t.true(files.length > 1)
})

test('filesFromPaths includes file size', async (t) => {
  const files = await filesFromPaths(['test/fixtures/empty.car'])
  t.is(files.length, 1)
  t.is(files[0].size, 18)
})

test('filesFromPaths removes common path prefix', async (t) => {
  const files = await filesFromPaths(['test/fixtures', './test/helpers'])
  t.true(files.length > 1)
  for (const file of files) {
    t.false(file.name.startsWith('test/'))
  }
})
