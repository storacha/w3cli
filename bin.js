#!/usr/bin/env node

import sade from 'sade'
import open from 'open'
import { getPkg } from './lib.js'
import { createSpace, registerSpace, createDelegation } from './index.js'

const cli = sade('w3')

cli
  .version(getPkg().version)
  .example('up path/to/files')

cli.command('open <cid>')
  .describe('open CID on https://w3s.link')
  .action(cid => open(`https://w3s.link/ipfs/${cid}`))

cli.command('space')
  .describe('Create and mangage w3 spaces')

cli.command('space create <name>')
  .describe('Create a new w3 space')
  .action(name => {
    createSpace(name)
    console.log(`Created ${name}`)
  })

cli.command('space register <email>')
  .describe('Claim the space by associating it with your email address')
  .action(email => {
    registerSpace(email)
  })

cli.command('delegation create <audience-did>')
  .describe('Create a delegation to the passed audience for the given abilities with the _current_ space as the resource.')
  .option('-a, --ability', 'One or more abilities to delegate.', '*')
  .option('-n, --name', 'Human readable name for the audience receiving the delegation.')
  .option('-t, --type', 'Type of the audience receiving the delegation, one of: device, app, service.')
  .option('-o, --output', 'Path of file to write the exported delegation data to.')
  .action(createDelegation)

cli.parse(process.argv)
