#!/usr/bin/env node

// Suppress experimental warnings from node
// see: https://github.com/nodejs/node/issues/30810

const defaultEmit = process.emit
process.emit = function (...args) {
  if (args[1].name === 'ExperimentalWarning') {
    return undefined
  }

  return defaultEmit.call(this, ...args)
}

await import('./bin.js')
