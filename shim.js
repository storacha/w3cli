#!/usr/bin/env node

// Suppress experimental warnings from node
// see: https://github.com/nodejs/node/issues/30810

const defaultEmit = process.emit
// @ts-expect-error
process.emit = function (...args) {
  // @ts-expect-error
  if (args[1].name === 'ExperimentalWarning') {
    return undefined
  }
  // @ts-expect-error
  return defaultEmit.call(this, ...args)
}

// @ts-expect-error
await import('./bin.js')
