#!/usr/bin/env node

import sade from 'sade'
import open from 'open'
import { getPkg } from './lib.js'

const cli = sade('w3')

cli
  .version(getPkg().version)
  .example('up path/to/files')

cli.command('open <cid>')
  .describe('open CID on https://w3s.link')
  .action(cid => open(`https://w3s.link/ipfs/${cid}`))

cli.parse(process.argv)
