import { create } from '@web3-storage/w3up-client'

export async function createSpace (name) {
  const client = await create()
  const space = await client.createSpace(name)
  await client.setCurrentSpace(space.did)
}

export async function registerSpace (address) {
  const client = await create()
  try {
    await client.registerSpace(address)
  } catch (err) {
    console.error('registration failed: ', err)
  }  
}
