import test from 'ava'
import { filesFromPaths, filesize } from '../lib.js'

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

test('filesFromPaths single file has name', async (t) => {
  const files = await filesFromPaths(['test/fixtures/empty.car'])
  t.is(files.length, 1)
  t.is(files[0].name, 'empty.car')
})

test('filesize', t => {
  [
    [5, '5B'],
    [50, '0.1KB'],
    [500, '0.5KB'],
    [5_000, '5.0KB'],
    [50_000, '0.1MB'],
    [500_000, '0.5MB'],
    [5_000_000, '5.0MB'],
    [50_000_000, '0.1GB'],
    [500_000_000, '0.5GB'],
    [5_000_000_000, '5.0GB']
  ].forEach(([size, str]) => t.is(filesize(size), str))
})
